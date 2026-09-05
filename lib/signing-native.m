#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <sys/stat.h>
#include <unistd.h>

static void fail(const char *message) {
    fprintf(stderr, "%s\n", message);
    exit(1);
}

static void check(OSStatus status, const char *operation) {
    if (status != errSecSuccess) {
        fprintf(stderr, "%s failed (OSStatus %d).\n", operation, (int)status);
        exit(1);
    }
}

static NSDictionary *readInput(void) {
    NSMutableData *data = [NSMutableData data];
    unsigned char buffer[1024];
    ssize_t count;
    while ((count = read(STDIN_FILENO, buffer, sizeof(buffer))) > 0) {
        [data appendBytes:buffer length:(NSUInteger)count];
        if (data.length > 16384) fail("Signing input is too large.");
    }
    if (count < 0) fail("Could not read signing input.");
    id input = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (![input isKindOfClass:NSDictionary.class]) fail("Invalid signing input.");
    return input;
}

static NSData *passwordData(NSDictionary *input, NSString *key) {
    id value = input[key];
    if (![value isKindOfClass:NSString.class] || [value length] < 32) fail("Invalid signing password.");
    return [value dataUsingEncoding:NSUTF8StringEncoding];
}

static void registerKeychain(SecKeychainRef keychain) {
    CFArrayRef current = NULL;
    check(SecKeychainCopySearchList(&current), "Read keychain search list");
    NSArray *existing = (__bridge NSArray *)current;
    if (![existing containsObject:(__bridge id)keychain]) {
        // codesign needs registration even when --keychain names the identity store.
        NSMutableArray *updated = [existing mutableCopy];
        [updated addObject:(__bridge id)keychain];
        check(SecKeychainSetSearchList((__bridge CFArrayRef)updated), "Register signing keychain");
    }
    CFRelease(current);
}

static NSData *certificateData(SecKeychainRef keychain) {
    SecIdentitySearchRef search = NULL;
    check(SecIdentitySearchCreate(keychain, CSSM_KEYUSE_SIGN, &search), "Find signing identity");
    SecIdentityRef identity = NULL;
    check(SecIdentitySearchCopyNext(search, &identity), "Read signing identity");
    SecIdentityRef extra = NULL;
    OSStatus next = SecIdentitySearchCopyNext(search, &extra);
    if (extra != NULL) CFRelease(extra);
    if (next != errSecItemNotFound) fail("The signing keychain must contain exactly one identity.");
    SecCertificateRef certificate = NULL;
    check(SecIdentityCopyCertificate(identity, &certificate), "Read signing certificate");
    NSData *data = CFBridgingRelease(SecCertificateCopyData(certificate));
    CFRelease(certificate);
    CFRelease(identity);
    CFRelease(search);
    if (data.length == 0) fail("The signing certificate is empty.");
    return data;
}

static void printCertificate(NSData *certificate) {
    NSDictionary *result = @{ @"certificate": [certificate base64EncodedStringWithOptions:0] };
    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    if (json == nil || fwrite(json.bytes, 1, json.length, stdout) != json.length) fail("Could not return signing certificate.");
    putchar('\n');
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 3 || argv[2][0] != '/') return 2;
        BOOL importing = strcmp(argv[1], "import") == 0;
        BOOL inspecting = strcmp(argv[1], "inspect") == 0;
        BOOL deleting = strcmp(argv[1], "delete") == 0;
        if ((!importing && !inspecting && !deleting) || argc != (importing ? 4 : 3)) return 2;
        check(SecKeychainSetUserInteractionAllowed(false), "Disable signing prompts");
        SecKeychainRef keychain = NULL;
        if (deleting) {
            check(SecKeychainOpen(argv[2], &keychain), "Open signing keychain");
            check(SecKeychainDelete(keychain), "Delete signing keychain");
            CFRelease(keychain);
            puts("{}");
            return 0;
        }
        NSDictionary *input = readInput();
        NSData *password = passwordData(input, @"password");
        if (importing) {
            NSData *p12Password = passwordData(input, @"p12Password");
            struct stat info;
            if (lstat(argv[2], &info) == 0) fail("The signing keychain already exists.");
            NSData *p12 = [NSData dataWithContentsOfFile:[NSString stringWithUTF8String:argv[3]]];
            if (p12.length == 0 || p12.length > 1048576) fail("Invalid signing identity file.");
            umask(0077);
            check(SecKeychainCreate(argv[2], (UInt32)password.length, password.bytes, false, NULL, &keychain), "Create signing keychain");
            SecTrustedApplicationRef codesign = NULL;
            check(SecTrustedApplicationCreateFromPath("/usr/bin/codesign", &codesign), "Identify codesign");
            SecAccessRef access = NULL;
            NSArray *trusted = @[(__bridge id)codesign];
            check(SecAccessCreate(CFSTR("Codex Fast Switch local signing"), (__bridge CFArrayRef)trusted, &access), "Create signing access policy");
            SecItemImportExportKeyParameters parameters = {0};
            parameters.version = SEC_KEY_IMPORT_EXPORT_PARAMS_VERSION;
            parameters.passphrase = (__bridge CFDataRef)p12Password;
            parameters.accessRef = access;
            parameters.keyUsage = (__bridge CFArrayRef)@[(__bridge id)kSecAttrCanSign];
            parameters.keyAttributes = (__bridge CFArrayRef)@[(__bridge id)kSecAttrIsPermanent, (__bridge id)kSecAttrIsSensitive];
            SecExternalFormat format = kSecFormatPKCS12;
            SecExternalItemType type = kSecItemTypeAggregate;
            OSStatus imported = SecItemImport((__bridge CFDataRef)p12, NULL, &format, &type, 0, &parameters, keychain, NULL);
            CFRelease(access);
            CFRelease(codesign);
            if (imported != errSecSuccess) {
                SecKeychainDelete(keychain);
                check(imported, "Import signing identity");
            }
        } else {
            check(SecKeychainOpen(argv[2], &keychain), "Open signing keychain");
            check(SecKeychainUnlock(keychain, (UInt32)password.length, password.bytes, true), "Unlock signing keychain");
        }
        NSData *certificate = certificateData(keychain);
        registerKeychain(keychain);
        printCertificate(certificate);
        CFRelease(keychain);
        return 0;
    }
}
