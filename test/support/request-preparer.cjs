// Independent reduced request pipeline, retaining the selector's reviewed syntax
// and the data flow between submission options, saved defaults and request routes.
module.exports = `function prepareSubmission(client, {settings}, readSavedTier, nextId, prepareResume) {
  return async (threadId, message) => {
    let options = message.submissionOptions;
    let conversation = client.getConversation(threadId);
    if (message.blocked) return {status: 'paused', reason: 'policy'};
    let [tier, permissions] = await Promise.all([(async () => {
      if (options == null) return readSavedTier(conversation?.latestModel || null);
      if (options.serviceTier == null) return null;
      let {account: identity} = await client.getAccount({priority: 'critical'});
      return identity?.type === 'chatgpt' ? options.serviceTier : null;
    })(), settings.readPermissionRefreshEnabled()]);
    let resume = {conversationId: threadId, serviceTier: tier, model: message.model};
    let start = {request: {threadId: threadId, serviceTier: tier, input: message.input,
      parentTurnId: message.parentTurnId, rootTurnId: message.rootTurnId, model: message.model},
      context: {permissions, original: message}};
    return {status: 'ready', submission: {resume, start, steer: {serviceTier: tier, input: message.input}}};
  };
}`;
