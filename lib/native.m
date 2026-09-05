#import <AppKit/AppKit.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static BOOL matchesApp(NSRunningApplication *app, NSString *path) {
    return [app.bundleURL.path.stringByResolvingSymlinksInPath isEqualToString:path.stringByResolvingSymlinksInPath];
}

int main(int argc, const char *argv[]) {
    if (argc == 3 && strcmp(argv[1], "quit") == 0) {
        @autoreleasepool {
            NSString *path = [NSString stringWithUTF8String:argv[2]];
            for (NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications) {
                if (matchesApp(app, path)) {
                    if (![app terminate]) {
                        fprintf(stderr, "The application refused the quit request.\n");
                        return 1;
                    }
                    puts("quit-requested");
                }
            }
        }
        return 0;
    }
    if (argc == 3 && strcmp(argv[1], "watch") == 0) {
        @autoreleasepool {
            NSString *path = [NSString stringWithUTF8String:argv[2]];
            id observer = [NSWorkspace.sharedWorkspace.notificationCenter
                addObserverForName:NSWorkspaceDidTerminateApplicationNotification object:nil
                queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *notification) {
                    if (matchesApp(notification.userInfo[NSWorkspaceApplicationKey], path)) {
                        puts("exited");
                        fflush(stdout);
                    }
                }];
            puts("watching");
            fflush(stdout);
            [NSRunLoop.currentRunLoop run];
            [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:observer];
        }
        return 0;
    }
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
    fprintf(stderr, "Use swap <left> <right>, notify <message>, quit <app>, or watch <app>.\n");
    return 2;
}
