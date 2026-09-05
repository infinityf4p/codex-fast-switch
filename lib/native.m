#import <AppKit/AppKit.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int main(int argc, const char *argv[]) {
    if (argc == 4 && strcmp(argv[1], "swap") == 0) {
        if (renamex_np(argv[2], argv[3], RENAME_SWAP) == 0) return 0;
        perror("atomic app exchange");
        return 1;
    }
    if (argc == 3 && strcmp(argv[1], "notify") == 0) {
        @autoreleasepool {
            [NSApplication sharedApplication];
            [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
            NSAlert *alert = [[NSAlert alloc] init];
            alert.messageText = @"Codex Fast Switch";
            alert.informativeText = [NSString stringWithUTF8String:argv[2]];
            [alert addButtonWithTitle:@"OK"];
            [NSApp activateIgnoringOtherApps:YES];
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
                [NSApp abortModal];
                [alert.window orderOut:nil];
            });
            [alert runModal];
        }
        return 0;
    }
    fprintf(stderr, "Use swap <left> <right>, or notify <message>.\n");
    return 2;
}
