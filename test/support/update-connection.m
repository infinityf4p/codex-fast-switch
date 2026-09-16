#import <Foundation/Foundation.h>

@interface SUInstallerConnection : NSObject
- (void)handleMessageWithIdentifier:(int32_t)identifier data:(NSData *)data;
@end
@implementation SUInstallerConnection
- (void)handleMessageWithIdentifier:(int32_t)identifier data:(NSData *)data {
    NSMutableArray *bytes = [NSMutableArray array];
    for (NSUInteger i = 0; i < data.length; i++) [bytes addObject:@(((const uint8_t *)data.bytes)[i])];
    NSData *json = [NSJSONSerialization dataWithJSONObject:@{@"identifier": @(identifier), @"bytes": bytes} options:0 error:nil];
    puts([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
}
@end
