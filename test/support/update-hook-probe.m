#import <Foundation/Foundation.h>
#include <dlfcn.h>

@interface NSObject (Probe)
+ (BOOL)installWithConfigurationAtPath:(NSString *)path;
- (void)handleMessageWithIdentifier:(int32_t)identifier data:(NSData *)data;
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 5 || !dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL) || !dlopen(argv[2], RTLD_NOW | RTLD_GLOBAL)) {
            fprintf(stderr, "Probe could not load libraries: %s\n", dlerror());
            return 1;
        }
        NSString *state = [NSString stringWithUTF8String:argv[3]];
        NSString *config = [state stringByAppendingPathComponent:@"hook.json"];
        NSData *json = [NSJSONSerialization dataWithJSONObject:@{@"schema": @1, @"state": state, @"app": NSBundle.mainBundle.bundlePath} options:0 error:nil];
        [json writeToFile:config atomically:YES];
        BOOL active = [NSClassFromString(@"CodexFastSwitchUpdateHook") installWithConfigurationAtPath:config];
        printf("{\"active\":%s}\n", active ? "true" : "false");
        if (strcmp(argv[4], "messages") == 0) {
            id connection = [[NSClassFromString(@"SUInstallerConnection") alloc] init];
            uint8_t bytes[] = {1, 1};
            [connection handleMessageWithIdentifier:0 data:[NSData dataWithBytes:bytes length:2]];
            [connection handleMessageWithIdentifier:2 data:[NSData dataWithBytes:bytes length:1]];
            [connection handleMessageWithIdentifier:2 data:[NSData dataWithBytes:bytes length:2]];
            bytes[0] = 0;
            [connection handleMessageWithIdentifier:2 data:[NSData dataWithBytes:bytes length:2]];
        }
    }
    return 0;
}
