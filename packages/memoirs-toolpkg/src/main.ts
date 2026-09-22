import memoirsScreen from "./ui/index.ui.js";
import { recordMessageActivity } from "./engine";
import { applyPendingContext, consumeContextAfterAssistantMessage } from "./chatSync";

const TOOLPKG_ID = "com.volumeofmemoirs.operit";
let registered = false;

export async function onChatMessage(event: ToolPkg.ChatMessageHookEvent): Promise<void> {
  try {
    await recordMessageActivity(event);
    await consumeContextAfterAssistantMessage(event);
  } catch (error) {
    console.log(`[memoirs] activity record failed ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function onPromptFinalize(event: any): Promise<Record<string, unknown> | null> {
  try {
    return await applyPendingContext(event);
  } catch (error) {
    console.log(`[memoirs] context injection failed ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function registerToolPkg(): boolean {
  if (registered) {
    console.log("[memoirs] registration skipped: already registered");
    return true;
  }
  const route = `toolpkg:${TOOLPKG_ID}:ui:memoirs`;
  ToolPkg.registerToolboxUiModule({
    id: "memoirs",
    runtime: "compose_dsl",
    screen: memoirsScreen,
    params: {},
    title: { zh: "记忆之书", en: "Volume of Memoirs" },
    keepAlive: true,
  });
  ToolPkg.registerNavigationEntry({
    id: "memoirs_sidebar",
    route,
    surface: "main_sidebar_plugins",
    title: { zh: "记忆之书", en: "Volume of Memoirs" },
    icon: "menu_book",
    order: 235,
  });
  ToolPkg.registerChatMessageHook({ id: "memoirs_activity", function: onChatMessage });
  ToolPkg.registerPromptFinalizeHook({ id: "memoirs_chat_context", function: onPromptFinalize });
  registered = true;
  console.log("[memoirs] registered");
  return true;
}
