import { createSignal, Show } from "solid-js"
import { activityEntry, createObserver, footerText, panelLines, toastForEvent } from "./graph-ui-core.mjs"

// Observability only: reads .sdlc/runs/<run>/graph-state.json and graph-events.jsonl.
// It never writes to any session, so nothing here reaches the model or provider.
export default {
  id: "sdlc.graph.ui.tui",
  setup(context: any) {
    const root = context.location?.directory ?? process.cwd()
    const [state, setState] = createSignal<any>(undefined)
    const [now, setNow] = createSignal(Date.now())
    const [activity, setActivity] = createSignal<any[]>([])
    const memo: Record<string, string> = {}

    const observer = createObserver(root, {
      onRunChange: () => setActivity([]),
      onHistory: (past: any[]) => setActivity(past.map(activityEntry).filter(Boolean)),
      onEvent: (ev: any, current: any) => {
        const entry = activityEntry(ev)
        if (entry) setActivity((list) => [...list, entry].slice(-60))
        if (ev.event === "GRAPH_STARTED") context.ui.panel.open("sdlc.graph")
        const toast = toastForEvent(ev, current, memo)
        if (toast) context.ui.toast.show({ title: "Graph SDLC", duration: 4000, ...toast })
      },
      onState: (next: any) => setState(next),
      onTerminal: (final: any) => {
        const ok = final.currentNode === "COMPLETE" || final.status === "COMPLETE" || final.status === "COMPLETED"
        void context.attention.notify({
          title: "Graph SDLC",
          message: ok ? "COMPLETE" : `${final.status} · ${final.currentNode}`,
          notification: { when: "blurred" },
          sound: { name: ok ? "done" : "error", when: "blurred" },
        }).catch(() => {})
      },
    })

    const Footer = () => (
      <Show when={footerText(state(), now(), activity())}>
        <text fg={context.theme.text.base}>{footerText(state(), now(), activity())}</text>
      </Show>
    )

    const stops = [
      context.ui.slot({ append: "home.footer.status", render: () => <Footer /> }),
      context.ui.slot({ append: "prompt.footer.status", render: () => <Footer /> }),
      context.ui.slot({
        append: "session.panel",
        render: (panel: any) => (
          <Show when={panel.name === "sdlc.graph"}>
            <box flexDirection="column">
              <text>Graph SDLC</text>
              {panelLines(state(), activity(), now()).map((line: string) => <text>{line || " "}</text>)}
            </box>
          </Show>
        ),
      }),
    ]

    context.keymap.layer(() => ({
      mode: "global",
      commands: [{ id: "sdlc.graph.panel", title: "Graph SDLC panel", group: "SDLC", palette: true, run: () => { context.ui.panel.open("sdlc.graph") } }],
    }))

    void observer.tick()
    const timer = setInterval(() => { setNow(Date.now()); void observer.tick().catch(() => {}) }, 500)
    return () => {
      clearInterval(timer)
      for (const stop of stops) if (typeof stop === "function") stop()
    }
  },
}
