#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#include <poll.h>
#include <unistd.h>

static NSDictionary *configuration;
static NSDictionary<NSString *, NSValue *> *originals;
static char workerKey;

static BOOL report(NSDictionary *value, BOOL active, NSString *reason) {
    NSDictionary *status = @{@"active": @(active), @"reason": reason, @"pid": @(getpid()),
        @"app": value[@"app"], @"checkedAt": [NSISO8601DateFormatter stringFromDate:NSDate.date timeZone:NSTimeZone.localTimeZone
        formatOptions:NSISO8601DateFormatWithInternetDateTime]};
    NSData *data = [NSJSONSerialization dataWithJSONObject:status options:0 error:nil];
    [data writeToFile:[value[@"state"] stringByAppendingPathComponent:@"update-hook-status.json"] atomically:YES];
    return active;
}

static NSDictionary *readConfiguration(NSString *path) {
    NSData *data = [NSData dataWithContentsOfFile:path];
    id value = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    return [value isKindOfClass:NSDictionary.class] ? value : nil;
}

static BOOL startWorker(id connection) {
    NSString *state = configuration[@"state"];
    NSDictionary *current = readConfiguration([state stringByAppendingPathComponent:@"automatic.json"]);
    if (![current[@"enabled"] isEqual:@YES] || ![current[@"app"] isEqual:configuration[@"app"]]) return NO;
    NSTask *previous = objc_getAssociatedObject(connection, &workerKey);
    if (previous.running) return YES;
    NSString *agent = [state stringByAppendingPathComponent:@"agent"];
    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:[agent stringByAppendingPathComponent:@"runtime/node"]];
    task.arguments = @[[agent stringByAppendingPathComponent:@"src/platforms/macos/relaunch.cjs"], state,
        configuration[@"app"], [NSString stringWithFormat:@"%d", getpid()]];
    task.environment = @{@"PATH": @"/usr/bin:/bin:/usr/sbin:/sbin", @"HOME": NSHomeDirectory(), @"TMPDIR": NSTemporaryDirectory()};
    task.qualityOfService = NSQualityOfServiceUserInitiated;
    NSPipe *ready = [NSPipe pipe];
    task.standardOutput = ready;
    NSString *log = [state stringByAppendingPathComponent:@"update-relaunch.log"];
    if (![NSFileManager.defaultManager fileExistsAtPath:log]) {
        [NSFileManager.defaultManager createFileAtPath:log contents:nil attributes:@{NSFilePosixPermissions:@0600}];
    }
    NSFileHandle *output = [NSFileHandle fileHandleForWritingAtPath:log];
    if (!output) return NO;
    [output seekToEndOfFile];
    task.standardError = output;
    if (![task launchAndReturnError:nil]) { [output closeFile]; return NO; }
    [output closeFile];
    int fd = ready.fileHandleForReading.fileDescriptor;
    struct pollfd input = {fd, POLLIN, 0};
    char response[6] = {0};
    BOOL acknowledged = poll(&input, 1, 2000) > 0 && read(fd, response, 5) == 5 && strcmp(response, "ready") == 0;
    [ready.fileHandleForReading closeFile];
    if (!acknowledged) { if (task.running) [task terminate]; return NO; }
    objc_setAssociatedObject(connection, &workerKey, task, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    return YES;
}

static void sendMessage(id connection, SEL selector, int32_t identifier, NSData *data) {
    // Sparkle 2.9.1's stage-2 packet is [relaunch, showUI]. Keep its host path and quit notifications intact.
    if (identifier == 2 && data.length == 2) {
        const uint8_t *bytes = data.bytes;
        BOOL ready = NO;
        if (bytes[0] == 1 && bytes[1] <= 1) {
            @try { ready = startWorker(connection); }
            @catch (NSException *error) { NSLog(@"Codex Fast Switch handoff unavailable: %@", error.reason); }
        }
        if (ready) {
            const uint8_t modified[] = {0, bytes[1]};
            data = [NSData dataWithBytes:modified length:sizeof(modified)];
        }
    }
    Class cls = object_getClass(connection);
    while (!originals[NSStringFromClass(cls)] && class_getSuperclass(cls)) cls = class_getSuperclass(cls);
    IMP original = [originals[NSStringFromClass(cls)] pointerValue];
    ((void (*)(id, SEL, int32_t, NSData *))original)(connection, selector, identifier, data);
}

@interface CodexFastSwitchUpdateHook : NSObject
+ (BOOL)installWithConfigurationAtPath:(NSString *)path;
@end

@implementation CodexFastSwitchUpdateHook
+ (BOOL)installWithConfigurationAtPath:(NSString *)path {
    NSDictionary *value = readConfiguration(path);
    if (![value[@"schema"] isEqual:@1] || ![value[@"app"] isKindOfClass:NSString.class] ||
        ![value[@"state"] isKindOfClass:NSString.class] || ![value[@"state"] isAbsolutePath] ||
        ![[value[@"app"] stringByResolvingSymlinksInPath] isEqual:NSBundle.mainBundle.bundlePath.stringByResolvingSymlinksInPath]) return NO;
    Class connection = NSClassFromString(@"SUInstallerConnection");
    if (!connection || ![[NSBundle bundleForClass:connection].infoDictionary[@"CFBundleShortVersionString"] isEqual:@"2.9.1"]) {
        return report(value, NO, @"Unsupported Sparkle version; background restart fallback remains available.");
    }
    if (originals) return report(value, [configuration isEqual:value], @"Hook already loaded.");
    SEL selector = NSSelectorFromString(@"handleMessageWithIdentifier:data:");
    NSMutableArray *classes = [NSMutableArray arrayWithObject:connection];
    Class xpc = NSClassFromString(@"SUXPCInstallerConnection");
    if (xpc) [classes addObject:xpc];
    for (Class cls in classes) {
        NSMethodSignature *signature = [cls instanceMethodSignatureForSelector:selector];
        if (signature.numberOfArguments != 4 || strcmp(signature.methodReturnType, "v") != 0 ||
            strcmp([signature getArgumentTypeAtIndex:2], "i") != 0 || strcmp([signature getArgumentTypeAtIndex:3], "@") != 0) {
            return report(value, NO, @"Unsupported Sparkle connection; background restart fallback remains available.");
        }
    }
    configuration = value;
    NSMutableDictionary *saved = [NSMutableDictionary dictionary];
    for (Class cls in classes) {
        Method method = class_getInstanceMethod(cls, selector);
        saved[NSStringFromClass(cls)] = [NSValue valueWithPointer:method_getImplementation(method)];
    }
    originals = [saved copy];
    for (Class cls in classes) method_setImplementation(class_getInstanceMethod(cls, selector), (IMP)sendMessage);
    return report(value, YES, @"Sparkle 2.9.1 restart handoff installed.");
}
@end
