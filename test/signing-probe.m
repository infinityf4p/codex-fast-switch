#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>

#ifndef PROBE_BUILD
#define PROBE_BUILD 1
#endif

static void result(NSDictionary *value) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
    fwrite(json.bytes, 1, json.length, stdout);
    fputc('\n', stdout);
}

static int failure(NSString *operation, OSStatus status) {
    result(@{@"operation": operation, @"status": @(status), @"build": @(PROBE_BUILD)});
    return 1;
}

static NSString *keychainPath(SecKeychainRef keychain) {
    char path[PATH_MAX];
    UInt32 length = sizeof(path);
    if (SecKeychainGetPath(keychain, &length, path) != errSecSuccess) return nil;
    return [[NSString alloc] initWithBytes:path length:length encoding:NSUTF8StringEncoding];
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        OSStatus status = SecKeychainSetUserInteractionAllowed(false);
        if (status != errSecSuccess) return failure(@"disable-ui", status);
        if (argc == 2 && strcmp(argv[1], "snapshot") == 0) {
            CFArrayRef list = NULL;
            status = SecKeychainCopySearchList(&list);
            if (status != errSecSuccess) return failure(@"search-list", status);
            NSMutableArray *paths = [NSMutableArray array];
            for (id reference in (__bridge NSArray *)list) {
                NSString *path = keychainPath((__bridge SecKeychainRef)reference);
                if (path == nil) { CFRelease(list); return failure(@"search-path", errSecInternalError); }
                [paths addObject:path];
            }
            CFRelease(list);
            SecKeychainRef defaultKeychain = NULL;
            status = SecKeychainCopyDefault(&defaultKeychain);
            if (status != errSecSuccess && status != errSecNoDefaultKeychain) return failure(@"default", status);
            NSString *defaultPath = defaultKeychain == NULL ? nil : keychainPath(defaultKeychain);
            if (defaultKeychain != NULL) CFRelease(defaultKeychain);
            result(@{@"searchList": paths, @"defaultKeychain": defaultPath ?: [NSNull null]});
            return 0;
        }
        if (argc != 3) return failure(@"arguments", errSecParam);
        NSString *command = [NSString stringWithUTF8String:argv[1]];
        NSString *path = [NSString stringWithUTF8String:argv[2]];
        NSString *parent = path.stringByDeletingLastPathComponent.stringByResolvingSymlinksInPath;
        if (![path.lastPathComponent isEqualToString:@"acl-test.keychain"] ||
            ![parent.lastPathComponent hasPrefix:@"codex-fast-signing-"] || !path.isAbsolutePath) {
            return failure(@"private-test-path-required", errSecParam);
        }
        if (![@[@"seed", @"read", @"delete"] containsObject:command]) return failure(@"command", errSecParam);
        SecKeychainRef keychain = NULL;
        if ([command isEqualToString:@"delete"]) {
            status = SecKeychainOpen(path.fileSystemRepresentation, &keychain);
            if (status != errSecSuccess || keychain == NULL) return failure(@"open-for-delete", status);
            status = SecKeychainDelete(keychain);
            CFRelease(keychain);
            result(@{@"status": @(status), @"build": @(PROBE_BUILD)});
            return status == errSecSuccess ? 0 : 1;
        }
        NSData *input = [[NSFileHandle fileHandleWithStandardInput] readDataToEndOfFile];
        NSDictionary *settings = [NSJSONSerialization JSONObjectWithData:input options:0 error:NULL];
        if (![settings isKindOfClass:[NSDictionary class]]) return failure(@"input", errSecParam);
        for (NSString *field in @[@"password", @"service", @"account", @"value"]) {
            if (![settings[field] isKindOfClass:[NSString class]] || [settings[field] length] == 0) return failure(@"input-field", errSecParam);
        }
        NSData *password = [settings[@"password"] dataUsingEncoding:NSUTF8StringEncoding];
        NSData *service = [settings[@"service"] dataUsingEncoding:NSUTF8StringEncoding];
        NSData *account = [settings[@"account"] dataUsingEncoding:NSUTF8StringEncoding];
        NSData *value = [settings[@"value"] dataUsingEncoding:NSUTF8StringEncoding];
        if ([command isEqualToString:@"seed"]) {
            status = SecKeychainCreate(path.fileSystemRepresentation, (UInt32)password.length,
                password.bytes, false, NULL, &keychain);
            if (status != errSecSuccess || keychain == NULL) return failure(@"create-private-keychain", status);
            SecTrustedApplicationRef trusted = NULL;
            status = SecTrustedApplicationCreateFromPath(NULL, &trusted);
            if (status != errSecSuccess) { CFRelease(keychain); return failure(@"trust-self", status); }
            const void *trustedValues[] = { trusted };
            CFArrayRef trustedList = CFArrayCreate(NULL, trustedValues, 1, &kCFTypeArrayCallBacks);
            SecAccessRef access = NULL;
            status = SecAccessCreate(CFSTR("Codex Fast Switch isolated signing test"), trustedList, &access);
            CFRelease(trustedList);
            CFRelease(trusted);
            if (status != errSecSuccess) { CFRelease(keychain); return failure(@"create-test-acl", status); }
            SecKeychainAttribute attributes[] = {
                { kSecServiceItemAttr, (UInt32)service.length, (void *)service.bytes },
                { kSecAccountItemAttr, (UInt32)account.length, (void *)account.bytes }
            };
            SecKeychainAttributeList attributeList = { 2, attributes };
            status = SecKeychainItemCreateFromContent(kSecGenericPasswordItemClass, &attributeList,
                (UInt32)value.length, value.bytes, keychain, access, NULL);
            CFRelease(access);
            CFRelease(keychain);
            result(@{@"status": @(status), @"build": @(PROBE_BUILD)});
            return status == errSecSuccess ? 0 : 1;
        }
        status = SecKeychainOpen(path.fileSystemRepresentation, &keychain);
        if (status != errSecSuccess || keychain == NULL) return failure(@"open-private-keychain", status);
        status = SecKeychainUnlock(keychain, (UInt32)password.length, password.bytes, true);
        if (status != errSecSuccess) { CFRelease(keychain); return failure(@"unlock-private-keychain", status); }
        UInt32 length = 0;
        void *bytes = NULL;
        status = SecKeychainFindGenericPassword(keychain, (UInt32)service.length, service.bytes,
            (UInt32)account.length, account.bytes, &length, &bytes, NULL);
        BOOL matches = status == errSecSuccess && length == value.length && memcmp(bytes, value.bytes, length) == 0;
        if (bytes != NULL) SecKeychainItemFreeContent(NULL, bytes);
        CFRelease(keychain);
        result(@{@"status": @(status), @"matches": @(matches), @"build": @(PROBE_BUILD)});
        return 0;
    }
}
