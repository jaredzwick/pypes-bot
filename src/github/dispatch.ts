export class GitHubAuthError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'GitHubAuthError';
  }
}

export class WorkflowNotFoundError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'WorkflowNotFoundError';
  }
}

export type DispatchInputs = {
  mentionId: string;
  task: string;
  slackChannel: string;
  slackThreadTs: string;
  slackUserId: string;
};

export type DispatchResult = {
  runUrl: string;
};

export class GitHubClient {
  constructor(
    private pat: string,
    private repo: string,
    private workflow: string,
    private ref: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async dispatch(inputs: DispatchInputs): Promise<DispatchResult> {
    const url = `https://api.github.com/repos/${this.repo}/actions/workflows/${encodeURIComponent(this.workflow)}/dispatches`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: this.ref,
        inputs: {
          mention_id: inputs.mentionId,
          task: inputs.task,
          slack_channel: inputs.slackChannel,
          slack_thread_ts: inputs.slackThreadTs,
          slack_user_id: inputs.slackUserId,
        },
      }),
    });

    if (res.status === 204) {
      return { runUrl: `https://github.com/${this.repo}/actions/workflows/${this.workflow}` };
    }
    if (res.status === 401 || res.status === 403) {
      throw new GitHubAuthError(`github workflow_dispatch returned ${res.status}: ${await res.text()}`);
    }
    if (res.status === 404) {
      throw new WorkflowNotFoundError(`workflow ${this.workflow} not found in ${this.repo}: ${await res.text()}`);
    }
    throw new Error(`github workflow_dispatch returned ${res.status}: ${await res.text()}`);
  }
}
