export function buildChannelFailureMessage(error: string): string {
  if (/OAuth token refresh failed/i.test(error) || /openai-codex/i.test(error)) {
    return [
      `I could not start this task because the OpenClaw model provider authentication failed.`,
      ``,
      `Problem: \`openai-codex\` OAuth token refresh failed.`,
      `Action needed: re-authenticate that provider in OpenClaw, then retry the run or send the message again.`,
      ``,
      `No crawl/tool work was executed before this failure.`,
    ].join('\n')
  }

  if (
    /FailoverError/i.test(error) ||
    /subagent\.run failed/i.test(error) ||
    /api\.runtime\.subagent/i.test(error) ||
    /semantic mode failed/i.test(error) ||
    /semantic session exceeded context-read limit/i.test(error)
  ) {
    return [
      `I could not start this task because the OpenClaw runtime failed before any Knotwork action was taken.`,
      ``,
      `Error: ${error.slice(0, 300)}`,
    ].join('\n')
  }

  return [
    `I could not complete this task safely.`,
    ``,
    `Reason: ${error.slice(0, 500)}`,
    ``,
    `No Knotwork change was applied.`,
  ].join('\n')
}
