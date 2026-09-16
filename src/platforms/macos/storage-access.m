#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <arpa/inet.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <unistd.h>

static BOOL writeBytes(const void *bytes, size_t length) {
    while (length) {
        ssize_t count = write(STDOUT_FILENO, bytes, length);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) return NO;
        bytes = (const char *)bytes + count;
        length -= (size_t)count;
    }
    return YES;
}

static int reply(OSStatus status, NSString *reason, NSDictionary *item) {
    NSMutableDictionary *value = [@{@"schema": @1, @"status": @(status), @"reason": reason} mutableCopy];
    if (item) value[@"item"] = item;
    NSData *encoded = [NSPropertyListSerialization dataWithPropertyList:value format:NSPropertyListBinaryFormat_v1_0 options:0 error:NULL];
    if (!encoded || encoded.length > 65536) return 1;
    uint32_t length = htonl((uint32_t)encoded.length);
    return writeBytes(&length, sizeof(length)) && writeBytes(encoded.bytes, encoded.length) ? 0 : 1;
}

static BOOL validClient(pid_t pid, NSDictionary *config, SecCodeRef *client) {
    NSString *app = config[@"app"], *requirement = config[@"clientRequirement"];
    if (![app isKindOfClass:NSString.class] || !app.isAbsolutePath ||
        ![requirement isKindOfClass:NSString.class]) return NO;
    SecRequirementRef rule = NULL;
    if (SecRequirementCreateWithString((__bridge CFStringRef)requirement, kSecCSDefaultFlags, &rule) != errSecSuccess) return NO;
    NSDictionary *attributes = @{(__bridge id)kSecGuestAttributePid: @(pid)};
    OSStatus status = SecCodeCopyGuestWithAttributes(NULL, (__bridge CFDictionaryRef)attributes, kSecCSDefaultFlags, client);
    if (status == errSecSuccess) status = SecCodeCheckValidity(*client, kSecCSStrictValidate, rule);
    CFURLRef url = NULL;
    if (status == errSecSuccess) status = SecCodeCopyPath(*client, kSecCSDefaultFlags, &url);
    NSString *actual = url ? [[(__bridge NSURL *)url path] stringByResolvingSymlinksInPath] : nil;
    NSString *expected = app.stringByResolvingSymlinksInPath;
    BOOL pathMatches = [actual isEqualToString:expected];
    if (!pathMatches) {
        NSDictionary *info = [NSDictionary dictionaryWithContentsOfFile:[expected stringByAppendingPathComponent:@"Contents/Info.plist"]];
        NSString *executable = info[@"CFBundleExecutable"];
        if ([executable isKindOfClass:NSString.class] && [executable isEqualToString:executable.lastPathComponent]) {
            pathMatches = [actual isEqualToString:[[expected stringByAppendingPathComponent:@"Contents/MacOS"] stringByAppendingPathComponent:executable]];
        }
    }
    // Validate the on-disk bundle as well as the live caller's certificate-bound identity.
    SecStaticCodeRef bundle = NULL;
    if (status == errSecSuccess && pathMatches) {
        status = SecStaticCodeCreateWithPath((__bridge CFURLRef)[NSURL fileURLWithPath:expected], kSecCSDefaultFlags, &bundle);
        if (status == errSecSuccess) status = SecStaticCodeCheckValidity(bundle, kSecCSStrictValidate, rule);
    }
    if (bundle) CFRelease(bundle);
    if (url) CFRelease(url);
    CFRelease(rule);
    return status == errSecSuccess && pathMatches;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        struct rlimit limit = {0, 0};
        setrlimit(RLIMIT_CORE, &limit);
        struct stat output;
        if (argc != 2 || strcmp(argv[1], "--read") || fstat(STDOUT_FILENO, &output) || !S_ISFIFO(output.st_mode)) return 2;
        NSString *file = [NSBundle.mainBundle pathForResource:@"storage-access" ofType:@"plist"];
        NSDictionary *config = file ? [NSDictionary dictionaryWithContentsOfFile:file] : nil;
        if (![config[@"schema"] isEqual:@1]) return reply(errSecParam, @"invalid-configuration", nil);
        if ([config[@"allowInteraction"] isEqual:@NO]) SecKeychainSetUserInteractionAllowed(false);
        pid_t parent = getppid();
        SecCodeRef client = NULL;
        if (parent <= 1 || !validClient(parent, config, &client)) {
            if (client) CFRelease(client);
            return reply(errSecAuthFailed, @"untrusted-client", nil);
        }
        NSString *service = config[@"service"], *account = config[@"account"];
        if (![service isKindOfClass:NSString.class] || !service.length ||
            ![account isKindOfClass:NSString.class] || !account.length) {
            CFRelease(client);
            return reply(errSecParam, @"invalid-item", nil);
        }
        NSMutableDictionary *query = [@{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: service, (__bridge id)kSecAttrAccount: account,
            (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne,
            (__bridge id)kSecReturnData: @YES, (__bridge id)kSecReturnAttributes: @YES} mutableCopy];
        SecKeychainRef keychain = NULL;
        NSString *keychainPath = config[@"keychain"];
        if (keychainPath) {
            if (![keychainPath isKindOfClass:NSString.class] || !keychainPath.isAbsolutePath ||
                SecKeychainOpen(keychainPath.fileSystemRepresentation, &keychain) != errSecSuccess) {
                CFRelease(client);
                return reply(errSecParam, @"unavailable-keychain", nil);
            }
            query[(__bridge id)kSecMatchSearchList] = @[(__bridge id)keychain];
        }
        CFTypeRef found = NULL;
        OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &found);
        if (keychain) CFRelease(keychain);
        // Authorization UI can outlive the caller; never deliver data to a replacement process.
        if (getppid() != parent || SecCodeCheckValidity(client, kSecCSStrictValidate, NULL) != errSecSuccess) status = errSecAuthFailed;
        CFRelease(client);
        NSDictionary *item = status == errSecSuccess && found && CFGetTypeID(found) == CFDictionaryGetTypeID() ? (__bridge NSDictionary *)found : nil;
        if (status == errSecSuccess && ![item[(__bridge id)kSecValueData] isKindOfClass:NSData.class]) status = errSecDecode;
        NSDictionary *response = status == errSecSuccess ? @{
            (__bridge id)kSecValueData: item[(__bridge id)kSecValueData],
            (__bridge id)kSecAttrService: service, (__bridge id)kSecAttrAccount: account,
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword} : nil;
        int result = reply(status, status == errSecSuccess ? @"read" : @"keychain-access-failed", response);
        if (found) CFRelease(found);
        return result;
    }
}
