#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <stdio.h>

#ifndef STORAGE_TEST_BUILD
#define STORAGE_TEST_BUILD 1
#endif

static const char *dummy = "storage-helper-test-only";

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        SecKeychainSetUserInteractionAllowed(false);
        if (argc == 4 && strcmp(argv[1], "seed") == 0) {
            NSString *file = @(argv[2]);
            if (![file.stringByDeletingLastPathComponent.lastPathComponent hasPrefix:@"codex-fast-storage-"]) return 2;
            NSData *password = [[NSFileHandle fileHandleWithStandardInput] readDataToEndOfFile];
            SecKeychainRef keychain = NULL;
            OSStatus status = SecKeychainCreate(file.fileSystemRepresentation, (UInt32)password.length, password.bytes, false, NULL, &keychain);
            SecTrustedApplicationRef helper = NULL;
            if (!status) status = SecTrustedApplicationCreateFromPath(argv[3], &helper);
            SecAccessRef access = NULL;
            if (!status) status = SecAccessCreate(CFSTR("Storage helper dummy item"), (__bridge CFArrayRef)@[(__bridge id)helper], &access);
            const char *service = "codex-fast-storage-dummy", *account = "dummy";
            SecKeychainAttribute attributes[] = {{kSecServiceItemAttr, (UInt32)strlen(service), (void *)service},
                {kSecAccountItemAttr, (UInt32)strlen(account), (void *)account}};
            SecKeychainAttributeList list = {2, attributes};
            if (!status) status = SecKeychainItemCreateFromContent(kSecGenericPasswordItemClass, &list,
                (UInt32)strlen(dummy), dummy, keychain, access, NULL);
            if (access) CFRelease(access);
            if (helper) CFRelease(helper);
            if (keychain) CFRelease(keychain);
            printf("{\"status\":%d}\n", (int)status);
            return status ? 1 : 0;
        }
        BOOL unrelated = argc == 2 && strcmp(argv[1], "unrelated") == 0;
        BOOL attributes = !(argc == 2 && strcmp(argv[1], "data-only") == 0);
        NSDictionary *query = @{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: unrelated ? @"codex-fast-nonexistent-unrelated" : @"Codex Storage Key",
            (__bridge id)kSecAttrAccount: @"Codex", (__bridge id)kSecReturnData: @YES,
            (__bridge id)kSecReturnAttributes: @(attributes), (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne};
        CFTypeRef result = NULL;
        OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
        NSData *data = nil;
        if (!status && result) data = attributes ? ((__bridge NSDictionary *)result)[(__bridge id)kSecValueData] : (__bridge NSData *)result;
        BOOL matches = [data isKindOfClass:NSData.class] && data.length == strlen(dummy) && memcmp(data.bytes, dummy, data.length) == 0;
        printf("{\"status\":%d,\"matches\":%s,\"build\":%d}\n", (int)status, matches ? "true" : "false", STORAGE_TEST_BUILD);
        if (result) CFRelease(result);
    }
    return 0;
}
