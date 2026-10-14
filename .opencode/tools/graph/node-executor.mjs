const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function collectText(value, output = []) {
  if (typeof value === "string") output.push(value)
  else if (Array.isArray(value)) value.forEach((item) => collectText(item, output))
  else if (value && typeof value === "object") {
    if (typeof value.text === "string") output.push(value.text)
    for (const [key, item] of Object.entries(value)) if (key !== "text") collectText(item, output)
  }
  return output
}

function sessionIdOf(session) {
  return session?.id || session?.sessionID || session?.data?.id || session?.data?.sessionID
}

async function waitWithTimeout(session, sessionID, timeoutMs) {
  let timer
  try {
    await Promise.race([
      session.wait({ sessionID }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`Node session timed out after ${timeoutMs}ms`), { failureClass: "TIMEOUT" })), timeoutMs) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export function createOpenCodeNodeExecutor(ctx, { timeoutMs = 300_000 } = {}) {
  if (!ctx?.session) throw new Error("OpenCode V2 session context is required")
  return {
    async executeNode({ agent, model, prompt, executionId, node }) {
      const created = await ctx.session.create({ title: `SDLC ${node} ${executionId}` })
      const sessionId = sessionIdOf(created)
      if (!sessionId) throw new Error("OpenCode did not return a session ID")
      await ctx.session.update({ sessionID: sessionId, title: `Graph ${node} · RUNNING` })
      const [providerID, id] = String(model || "").split("/", 2)
      if (!providerID || !id) throw new Error(`Invalid configured model: ${model}`)
      await ctx.session.switchAgent({ sessionID: sessionId, agent })
      await ctx.session.switchModel({ sessionID: sessionId, model: { providerID, id } })
      await ctx.session.prompt({ sessionID: sessionId, text: prompt })
      await waitWithTimeout(ctx.session, sessionId, timeoutMs)
      const messages = await ctx.session.context({ sessionID: sessionId })
      const text = collectText(messages).join("\n")
      await ctx.session.update({ sessionID: sessionId, title: `Graph ${node} · RESULT RECEIVED` })
      return { sessionId, text, actualModel: "NOT_EXTERNALLY_VERIFIED" }
    },
    async interrupt(sessionId) {
      await ctx.session.interrupt({ sessionID: sessionId, continue: false })
      await sleep(0)
    },
  }
}
