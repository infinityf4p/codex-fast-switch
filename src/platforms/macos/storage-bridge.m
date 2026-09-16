#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

static NSDictionary *configuration;
static NSDictionary *cachedItem;
static NSLock *accessLock;

static BOOL isolatedKeychain(void) { return [configuration[@"denyOtherKeychainReads"] isEqual:@YES]; }

static void report(NSString *reason, OSStatus status) {
    NSString *file = configuration[@"statusPath"];
    if (![file isKindOfClass:NSString.class] || !file.isAbsolutePath) return;
    NSDictionary *value = @{@"schema": @1, @"loaded": @YES, @"reason": reason, @"status": @(status),
        @"pid": @(getpid()), @"checkedAt": [NSISO8601DateFormatter.new stringFromDate:NSDate.date]};
    NSData *json = [NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
    [json writeToFile:file options:NSDataWritingAtomic error:NULL];
    chmod(file.fileSystemRepresentation, 0600);
}

__attribute__((constructor)) static void initializeBridge(void) {
    @autoreleasepool {
        NSString *file = [NSBundle.mainBundle pathForResource:@"codex-fast-storage" ofType:@"plist"];
        configuration = file ? [NSDictionary dictionaryWithContentsOfFile:file] : nil;
        if (![configuration[@"schema"] isEqual:@1]) { configuration = nil; return; }
        accessLock = NSLock.new;
        report(@"loaded", errSecSuccess);
    }
}

static BOOL readBytes(int fd, void *bytes, size_t length, double deadline) {
    while (length) {
        double remaining = deadline - NSProcessInfo.processInfo.systemUptime;
        if (remaining <= 0) return NO;
        struct pollfd event = {fd, POLLIN, 0};
        int ready = poll(&event, 1, (int)MIN(remaining * 1000, 1000));
        if (ready < 0 && errno == EINTR) continue;
        if (ready < 0) return NO;
        if (!ready) continue;
        ssize_t count = read(fd, bytes, length);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) return NO;
        bytes = (char *)bytes + count;
        length -= (size_t)count;
    }
    return YES;
}

static BOOL validHelper(NSString *bundle) {
    NSString *requirement = configuration[@"helperRequirement"];
    if (![bundle isKindOfClass:NSString.class] || !bundle.isAbsolutePath ||
        ![requirement isKindOfClass:NSString.class]) return NO;
    SecStaticCodeRef code = NULL;
    SecRequirementRef rule = NULL;
    OSStatus status = SecRequirementCreateWithString((__bridge CFStringRef)requirement, kSecCSDefaultFlags, &rule);
    if (status == errSecSuccess) status = SecStaticCodeCreateWithPath((__bridge CFURLRef)[NSURL fileURLWithPath:bundle], kSecCSDefaultFlags, &code);
    if (status == errSecSuccess) status = SecStaticCodeCheckValidity(code, kSecCSStrictValidate, rule);
    if (code) CFRelease(code);
    if (rule) CFRelease(rule);
    return status == errSecSuccess;
}

static OSStatus loadItem(void) {
    if (cachedItem) return errSecSuccess;
    NSString *bundle = configuration[@"helper"];
    if (!validHelper(bundle)) { report(@"invalid-helper", errSecAuthFailed); return errSecAuthFailed; }
    NSString *binary = [bundle stringByAppendingPathComponent:@"Contents/MacOS/storage-access"];
    int output[2];
    if (pipe(output)) return errSecNotAvailable;
    fcntl(output[0], F_SETFD, FD_CLOEXEC);
    fcntl(output[1], F_SETFD, FD_CLOEXEC);
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0);
    posix_spawn_file_actions_addopen(&actions, STDERR_FILENO, "/dev/null", O_WRONLY, 0);
    posix_spawn_file_actions_adddup2(&actions, output[1], STDOUT_FILENO);
    posix_spawn_file_actions_addclose(&actions, output[0]);
    posix_spawn_file_actions_addclose(&actions, output[1]);
    char *args[] = {(char *)binary.fileSystemRepresentation, "--read", NULL};
    NSString *home = [@"HOME=" stringByAppendingString:NSHomeDirectory()];
    char *environment[] = {(char *)home.UTF8String, "PATH=/usr/bin:/bin:/usr/sbin:/sbin", NULL};
    pid_t pid;
    int spawned = posix_spawn(&pid, binary.fileSystemRepresentation, &actions, NULL, args, environment);
    posix_spawn_file_actions_destroy(&actions);
    close(output[1]);
    if (spawned) { close(output[0]); report(@"helper-start-failed", errSecNotAvailable); return errSecNotAvailable; }
    double deadline = NSProcessInfo.processInfo.systemUptime + 120;
    uint32_t networkLength;
    BOOL complete = readBytes(output[0], &networkLength, sizeof(networkLength), deadline);
    uint32_t length = complete ? ntohl(networkLength) : 0;
    NSMutableData *data = length > 0 && length <= 65536 ? [NSMutableData dataWithLength:length] : nil;
    complete = data && readBytes(output[0], data.mutableBytes, length, deadline);
    close(output[0]);
    if (!complete) kill(pid, SIGTERM);
    int childStatus = 0;
    while (waitpid(pid, &childStatus, 0) < 0 && errno == EINTR) {}
    NSDictionary *message = complete ? [NSPropertyListSerialization propertyListWithData:data options:0 format:NULL error:NULL] : nil;
    if (data.length) memset_s(data.mutableBytes, data.length, 0, data.length);
    if (![message isKindOfClass:NSDictionary.class] || ![message[@"schema"] isEqual:@1] ||
        ![message[@"status"] isKindOfClass:NSNumber.class]) {
        report(@"invalid-helper-response", errSecNotAvailable); return errSecNotAvailable;
    }
    OSStatus status = [message[@"status"] intValue];
    NSDictionary *item = message[@"item"];
    if (status == errSecSuccess && (![item isKindOfClass:NSDictionary.class] ||
        ![item[(__bridge id)kSecValueData] isKindOfClass:NSData.class])) status = errSecDecode;
    if (status == errSecSuccess) cachedItem = item;
    // A failed helper must not trigger creation of a replacement encryption key.
    if (status == errSecItemNotFound) status = errSecNotAvailable;
    report(status == errSecSuccess ? @"read" : @"helper-access-failed", status);
    return status;
}

static BOOL targetQuery(CFDictionaryRef query) {
    if (!configuration || !query || CFGetTypeID(query) != CFDictionaryGetTypeID()) return NO;
    NSDictionary *value = (__bridge NSDictionary *)query;
    return [value[(__bridge id)kSecClass] isEqual:(__bridge id)kSecClassGenericPassword] &&
        [value[(__bridge id)kSecAttrService] isEqual:@"Codex Storage Key"] &&
        [value[(__bridge id)kSecAttrAccount] isEqual:@"Codex"] &&
        [value[(__bridge id)kSecReturnData] isEqual:@YES];
}

static OSStatus storageItemCopyMatching(CFDictionaryRef query, CFTypeRef *result) {
    if (!targetQuery(query)) return isolatedKeychain() ? errSecInteractionNotAllowed : SecItemCopyMatching(query, result);
    @autoreleasepool {
        NSDictionary *value = (__bridge NSDictionary *)query;
        if ([value[(__bridge id)kSecReturnRef] isEqual:@YES] ||
            [value[(__bridge id)kSecReturnPersistentRef] isEqual:@YES] ||
            [value[(__bridge id)kSecUseDataProtectionKeychain] isEqual:@YES] ||
            [value[(__bridge id)kSecMatchLimit] isEqual:(__bridge id)kSecMatchLimitAll]) return errSecParam;
        [accessLock lock];
        OSStatus status = loadItem();
        if (status == errSecSuccess && result) {
            id output = [value[(__bridge id)kSecReturnAttributes] isEqual:@YES] ? cachedItem : cachedItem[(__bridge id)kSecValueData];
            *result = CFBridgingRetain(output);
        }
        [accessLock unlock];
        return status;
    }
}

// Isolated app fixtures must not fall through to the user's Keychain, including legacy APIs.
static OSStatus storageItemAdd(CFDictionaryRef attributes, CFTypeRef *result) {
    return isolatedKeychain() ? errSecInteractionNotAllowed : SecItemAdd(attributes, result);
}
static OSStatus storageItemUpdate(CFDictionaryRef query, CFDictionaryRef attributes) {
    return isolatedKeychain() ? errSecInteractionNotAllowed : SecItemUpdate(query, attributes);
}
static OSStatus storageItemDelete(CFDictionaryRef query) {
    return isolatedKeychain() ? errSecInteractionNotAllowed : SecItemDelete(query);
}
static OSStatus storageFindGenericPassword(CFTypeRef keychains, UInt32 serviceLength, const char *service,
    UInt32 accountLength, const char *account, UInt32 *length, void **data, SecKeychainItemRef *item) {
    return isolatedKeychain() ? errSecInteractionNotAllowed : SecKeychainFindGenericPassword(keychains, serviceLength,
        service, accountLength, account, length, data, item);
}
static OSStatus storageAddGenericPassword(SecKeychainRef keychain, UInt32 serviceLength, const char *service,
    UInt32 accountLength, const char *account, UInt32 length, const void *data, SecKeychainItemRef *item) {
    return isolatedKeychain() ? errSecInteractionNotAllowed : SecKeychainAddGenericPassword(keychain, serviceLength,
        service, accountLength, account, length, data, item);
}

__attribute__((used, section("__DATA,__interpose"))) static const struct {
    const void *replacement;
    const void *original;
} storageInterpose[] = {
    {(const void *)storageItemCopyMatching, (const void *)SecItemCopyMatching},
    {(const void *)storageItemAdd, (const void *)SecItemAdd},
    {(const void *)storageItemUpdate, (const void *)SecItemUpdate},
    {(const void *)storageItemDelete, (const void *)SecItemDelete},
    {(const void *)storageFindGenericPassword, (const void *)SecKeychainFindGenericPassword},
    {(const void *)storageAddGenericPassword, (const void *)SecKeychainAddGenericPassword},
};
