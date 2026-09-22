import type { ComposeDslContext, ComposeNode } from "../operitComposeTypes";
import {
  acceptToday,
  addUserAnnotation,
  askCurrentRoleToAnnotate,
  askCurrentRoleToChoose,
  chooseUserPage,
  getSnapshot,
  returnToBoundChat,
  skipToday,
  updateSettings,
  type MemoirsSnapshot,
} from "../engine";
import { ensureInvitationWorkflow } from "../chatSync";

function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function unwrap(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function asObject(value: unknown): Record<string, unknown> {
  const input = unwrap(value);
  if (input && typeof input === "object") return input as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(input || "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function clientSnapshot(snapshot: MemoirsSnapshot): Record<string, unknown> {
  return {
    date: snapshot.date,
    chat: snapshot.chat,
    roleName: snapshot.roleName,
    sourceCount: snapshot.sourceCount,
    sourceErrors: snapshot.sourceErrors,
    sourceRoots: snapshot.sourceRoots,
    settings: snapshot.settings,
    availableChats: snapshot.availableChats,
    event: snapshot.event,
    book: snapshot.book ? {
      id: snapshot.book.id,
      date: snapshot.book.date,
      pageCount: snapshot.book.pages.length,
      sourceCount: snapshot.book.sourceCount,
    } : null,
    revealed: snapshot.revealed.map((item) => ({
      page: item.page,
      selectedBy: item.selectedBy.map((name) => name === "assistant" ? snapshot.roleName : name),
      memory: {
        id: item.memory.id,
        title: item.memory.title,
        body: item.memory.body,
        type: item.memory.type,
        domain: item.memory.domain,
        tags: item.memory.tags,
        createdAt: item.memory.createdAt,
      },
      annotations: item.annotations,
    })),
    readingLog: snapshot.readingLog.map((session) => ({
      ...session,
      items: session.items.map((item) => ({
        page: item.page,
        selectedBy: item.selectedBy,
        memory: {
          id: item.memory.id,
          title: item.memory.title,
          body: item.memory.body,
          type: item.memory.type,
          domain: item.memory.domain,
          tags: item.memory.tags,
          createdAt: item.memory.createdAt,
        },
        annotations: item.annotations,
      })),
    })),
    chatSync: snapshot.chatSync,
    workflow: snapshot.workflow,
  };
}

export default function Screen(ctx: ComposeDslContext): ComposeNode {
  const controller = ctx.useMemo("memoirs-controller", () => ctx.createWebViewController("volume-of-memoirs"), []);
  const loaded = ctx.useRef("memoirs-loaded", false);
  const snapshotRef = ctx.useRef<MemoirsSnapshot | null>("memoirs-snapshot", null);

  function toast(message: string): void {
    void Promise.resolve(ctx.showToast(message));
  }

  async function stateJson(snapshot?: MemoirsSnapshot): Promise<string> {
    const next = snapshot || await getSnapshot(false);
    snapshotRef.current = next;
    return JSON.stringify(clientSnapshot(next));
  }

  function pushSnapshot(snapshot: MemoirsSnapshot): void {
    snapshotRef.current = snapshot;
    void Promise.resolve(controller.evaluateJavascript(
      `window.MemoirsApp && window.MemoirsApp.setState(${escapeScriptJson(clientSnapshot(snapshot))});`
    ));
  }

  function pushError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    void Promise.resolve(controller.evaluateJavascript(
      `window.MemoirsApp && window.MemoirsApp.fail(${escapeScriptJson(message)});`
    ));
  }

  async function load(): Promise<void> {
    if (loaded.current) return;
    loaded.current = true;
    controller.addJavascriptInterface("MemoirsBridge", {
      async ready() {
        return stateJson();
      },
      async refresh() {
        return stateJson();
      },
      accept() {
        const current = snapshotRef.current;
        void Promise.resolve()
          .then(() => acceptToday())
          .then(pushSnapshot)
          .catch(pushError);
        return JSON.stringify(current ? { ...clientSnapshot(current), generating: true } : { generating: true });
      },
      async skip() {
        return stateJson(await skipToday());
      },
      async chooseUser(payload: unknown) {
        const page = Number(asObject(payload).page || 0);
        return stateJson(await chooseUserPage(page));
      },
      async chooseAssistant() {
        toast("正在请当前角色盲选页码");
        return stateJson(await askCurrentRoleToChoose());
      },
      async addUserNote(payload: unknown) {
        const value = asObject(payload);
        return stateJson(await addUserAnnotation(String(value.memoryId || ""), String(value.content || "")));
      },
      async askAssistantNote(payload: unknown) {
        const value = asObject(payload);
        toast("正在询问当前角色是否留下批注");
        return stateJson(await askCurrentRoleToAnnotate(String(value.memoryId || "")));
      },
      async saveSettings(payload: unknown) {
        const value = asObject(payload);
        return stateJson(await updateSettings({
          maxPages: Number(value.maxPages),
          cooldownDays: Number(value.cooldownDays),
          minBodyChars: Number(value.minBodyChars),
          excludeResolved: Boolean(value.excludeResolved),
          excludeDigested: Boolean(value.excludeDigested),
          chatBinding: value.chatBinding === "fixed" ? "fixed" : "current",
          fixedChatId: String(value.fixedChatId || ""),
          autoInvitationEnabled: Boolean(value.autoInvitationEnabled),
          invitationIdleMinutes: Number(value.invitationIdleMinutes),
        }));
      },
      async returnToChat() {
        return stateJson(await returnToBoundChat());
      },
      async installWorkflow() {
        const result = await ensureInvitationWorkflow();
        toast(result.created ? "自动邀请已启用" : "自动邀请工作流已启用");
        return stateJson();
      },
    });
    controller.loadHtml(buildHtml(), { baseUrl: "https://local.memoirs/" });
  }

  return ctx.UI.WebView({
    fillMaxSize: true,
    controller,
    javaScriptEnabled: true,
    domStorageEnabled: false,
    allowFileAccess: false,
    allowContentAccess: false,
    mixedContentMode: "neverAllow",
    onLoad: load,
  });
}

function buildHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>
:root{color-scheme:dark;--ink:#ece3d3;--muted:#a89e8e;--paper:#29251f;--paper2:#1e1b17;--line:#4e4639;--gold:#bba16c;--red:#8b4a43}
*{box-sizing:border-box}body{margin:0;background:#15130f;color:var(--ink);font:15px/1.65 Georgia,"Noto Serif SC",serif}
button,input,select{font:inherit}.app{max-width:760px;margin:auto;padding:24px 18px 72px}.mast{text-align:center;padding:28px 0 20px;border-bottom:1px solid var(--line)}
.eyebrow{font:11px/1.2 sans-serif;letter-spacing:.28em;color:var(--gold);text-transform:uppercase}.mast h1{font-size:34px;font-weight:500;margin:8px 0 0}.date{color:var(--muted);font-size:13px}
.nav{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--line)}.nav button{border:0;background:transparent;color:var(--muted);padding:14px;letter-spacing:.12em}.nav button.active{color:var(--gold);box-shadow:inset 0 -2px var(--gold)}
.card{background:linear-gradient(145deg,var(--paper),var(--paper2));border:1px solid var(--line);border-radius:3px;padding:22px;margin-top:18px;box-shadow:0 10px 34px #0005}
.cover{text-align:center;padding:38px 22px}.cover .count{font-size:46px;line-height:1;margin:18px 0 8px;color:var(--gold)}.muted{color:var(--muted)}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.btn{border:1px solid var(--gold);background:transparent;color:var(--ink);padding:10px 16px;border-radius:2px;cursor:pointer}.btn.primary{background:var(--gold);color:#19150f}.btn.quiet{border-color:var(--line);color:var(--muted)}.btn:disabled{opacity:.45}
.pick{display:grid;grid-template-columns:1fr auto;gap:10px;margin-top:18px}.pick input,.note-row input,.setting input,.setting select{width:100%;background:#14120f;color:var(--ink);border:1px solid var(--line);padding:11px;border-radius:2px}
.selection{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}.seal{border:1px dashed var(--line);padding:14px;text-align:center}.seal b{color:var(--gold);font-size:22px}.page{position:relative;padding-top:34px}.page-no{position:absolute;top:10px;right:15px;color:var(--gold);font-size:12px;letter-spacing:.14em}.page h2{font-size:20px;font-weight:500;margin:0 0 14px}.body{white-space:pre-wrap}.tags{font:12px/1.6 sans-serif;color:var(--muted);margin-top:18px}.chosen{color:var(--gold);font-size:13px;margin-bottom:10px}
.notes{border-top:1px solid var(--line);margin-top:20px;padding-top:14px}.note{margin:8px 0;color:#d6ccbc}.note b{color:var(--gold)}.note-row{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:12px}
.settings summary{cursor:pointer;color:var(--muted)}.setting{display:grid;grid-template-columns:1fr 110px;gap:12px;align-items:center;margin:11px 0}.checks{display:flex;gap:18px;flex-wrap:wrap;color:var(--muted)}
.status{font:12px/1.5 sans-serif;color:var(--muted);margin-top:16px}.error{color:#d98c83}.loading{opacity:.65;pointer-events:none}.history-head{display:flex;justify-content:space-between;gap:12px;align-items:baseline}.history-date{color:var(--gold)}.history-item{border-top:1px solid var(--line);margin-top:16px;padding-top:16px}.history-item:first-of-type{border-top:0}.history-item h3{font-size:18px;font-weight:500;margin:5px 0 10px}@media(max-width:520px){.selection{grid-template-columns:1fr}.mast h1{font-size:29px}}
</style>
</head><body><main class="app" id="app"><div class="mast"><div class="eyebrow">Volume of Memoirs</div><h1>记忆之书</h1><div class="date">正在取书</div></div></main>
<script>
const app=document.getElementById('app');let state=null,busy=false,view='book';
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function bridge(name,payload){if(busy)return;busy=true;app.classList.add('loading');const done=v=>{busy=false;app.classList.remove('loading');try{state=typeof v==='string'?JSON.parse(v):v;render()}catch(e){showError(e)}};const fail=e=>{busy=false;app.classList.remove('loading');showError(e)};try{Promise.resolve(MemoirsBridge[name](payload===undefined?undefined:JSON.stringify(payload))).then(done,fail)}catch(e){fail(e)}}
function showError(e){const msg=esc(e&&e.message?e.message:e);let box=document.getElementById('err');if(!box){box=document.createElement('div');box.id='err';box.className='card error';app.prepend(box)}box.innerHTML=msg}
function header(){return '<div class="mast"><div class="eyebrow">Volume of Memoirs</div><h1>记忆之书</h1><div class="date">'+esc(state.date)+(state.chat?' · '+esc(state.chat.title):'')+'</div></div><nav class="nav"><button data-view="book" class="'+(view==='book'?'active':'')+'">今日书册</button><button data-view="history" class="'+(view==='history'?'active':'')+'">阅读记录</button></nav>'}
function render(){if(!state)return;let h=header();if(view==='history')h+=history();else{if(!state.chat)h+='<section class="card"><h2>没有找到绑定的聊天</h2><p class="muted">在下方设置里重新选择一个窗口，书就会找到归处。</p></section>';else if(state.event.status==='skipped')h+='<section class="card cover"><div class="eyebrow">Closed for today</div><p>今天不读。书已经合上，明天再说。</p></section>';else if(!state.book)h+=invite();else h+=book();h+=settings()}app.innerHTML=h;bind()}
function invite(){return '<section class="card cover"><div class="eyebrow">A book for today</div><h2>让散落的旧日，在今天重新成书。</h2><p class="muted">有些事沉在时间里，并没有离开。它们只是安静地伏在纸页背后，等一次偶然的指尖。今天，你们会各自选中一个未知的页码；直到书被翻开，谁也不知道旧日将从哪里归来。</p><div class="actions" style="justify-content:center"><button class="btn primary" data-act="accept" '+(state.generating?'disabled':'')+'>'+(state.generating?'正在装订…':'让今日成书')+'</button>'+(state.generating?'':'<button class="btn quiet" data-act="skip">今天不读</button>')+'</div></section>'}
function book(){const b=state.book,e=state.event;let h='<section class="card cover"><div class="eyebrow">'+esc(b.date)+'</div><div class="count">'+b.pageCount+'</div><div>页</div><p class="muted">今日的旧事已经装订。页码无言，内容仍藏在纸后。</p></section>';
if(e.status!=='completed'){h+='<section class="card"><h2>双方盲选</h2><p class="muted">书页仍然合拢。各自留下一枚页码，旧日才会显影。</p><div class="selection"><div class="seal">Reiko<br><b>'+(e.userPage||'未选')+'</b></div><div class="seal">'+esc(state.roleName)+'<br><b>'+(e.assistantPage||'未选')+'</b></div></div>'+(e.userPage?'':'<div class="pick"><input id="userPage" inputmode="numeric" placeholder="输入 1–'+b.pageCount+'"><button class="btn" data-act="user-pick">选这一页</button></div>')+(e.assistantPage?'':'<div class="actions"><button class="btn" data-act="assistant-pick">请 '+esc(state.roleName)+' 盲选</button></div>')+'<p class="status">只有双方都选定后才会揭页。</p></section>'}
if(e.status==='completed'){for(const p of state.revealed)h+=page(p);const sync=state.chatSync&&state.chatSync.latestReadingStatus;const words=sync==='consumed'?'这次共读已经回到对话里。':sync==='in_flight'?'这次共读正在随你刚刚发出的消息回到对话。':'这次共读已经收好，会在你回去后发送的下一条真实消息里被记起。';h+='<section class="card"><div class="eyebrow">Back to conversation</div><h2>把刚刚发生的事带回去。</h2><p class="muted">'+words+'</p><div class="actions"><button class="btn primary" data-act="return-chat">回到对话</button></div></section>'}return h}
function page(p){const m=p.memory;let notes=p.annotations.map(n=>'<div class="note"><b>'+esc(n.authorName)+'</b> · '+esc(n.date)+'<br>'+esc(n.content)+'</div>').join('');return '<article class="card page"><div class="page-no">PAGE '+p.page+'</div><div class="chosen">'+esc(p.selectedBy.join('、'))+' 翻开了这一页</div><h2>'+esc(m.title||'无题记忆')+'</h2><div class="body">'+esc(m.body)+'</div><div class="tags">'+esc([m.type,...(m.domain||[]),...(m.tags||[])].filter(Boolean).join(' · '))+'</div><div class="notes"><div class="eyebrow">Annotations</div>'+notes+'<div class="note-row"><input id="note_'+esc(m.id)+'" maxlength="160" placeholder="留一句很短的批注"><button class="btn" data-note="'+esc(m.id)+'">写下</button></div><div class="actions"><button class="btn quiet" data-role-note="'+esc(m.id)+'">问 '+esc(state.roleName)+' 是否批注</button></div></div></article>'}
function history(){const sessions=state.readingLog||[];if(!sessions.length)return '<section class="card cover"><div class="eyebrow">Reading history</div><h2>还没有被翻开的旧页。</h2><p class="muted">第一次阅读之后，记忆、日期与当时写下的话会留在这里。</p></section>';return sessions.map(s=>'<section class="card"><div class="history-head"><div><div class="eyebrow">Reading record</div><div class="history-date">'+esc(s.date)+'</div></div><div class="muted">Reiko '+s.userPage+' · '+esc(state.roleName)+' '+s.assistantPage+'</div></div>'+s.items.map(i=>'<article class="history-item"><div class="chosen">'+esc(i.selectedBy.join('、'))+' · 第 '+i.page+' 页</div><h3>'+esc(i.memory.title||'无题记忆')+'</h3><div class="body">'+esc(i.memory.body)+'</div><div class="tags">'+esc([i.memory.type,...(i.memory.domain||[]),...(i.memory.tags||[])].filter(Boolean).join(' · '))+'</div>'+(i.annotations.length?'<div class="notes">'+i.annotations.map(n=>'<div class="note"><b>'+esc(n.authorName)+'</b> · '+esc(n.date)+'<br>'+esc(n.content)+'</div>').join('')+'</div>':'')+'</article>').join('')+'</section>').join('')}
function settings(){const s=state.settings;const options=(state.availableChats||[]).map(c=>'<option value="'+esc(c.chatId)+'" '+(s.fixedChatId===c.chatId?'selected':'')+'>'+esc(c.title+(c.characterName?' · '+c.characterName:''))+'</option>').join('');const roots=(state.sourceRoots||[]).map(esc).join('<br>');const workflow=state.workflow&&state.workflow.id;return '<details class="card settings"><summary>成书与窗口设置</summary><div class="setting"><label>聊天窗口绑定</label><select id="chatBinding"><option value="current" '+(s.chatBinding==='current'?'selected':'')+'>跟随当前窗口</option><option value="fixed" '+(s.chatBinding==='fixed'?'selected':'')+'>固定窗口</option></select></div><div class="setting"><label>固定到</label><select id="fixedChatId"><option value="">请选择窗口</option>'+options+'</select></div><p class="status">固定窗口后，成书、盲选、批注与共读同步都只作用于这个窗口。</p><div class="setting"><label>每日最多页数</label><input id="maxPages" type="number" min="2" max="500" value="'+s.maxPages+'"></div><div class="setting"><label>读后冷却天数</label><input id="cooldownDays" type="number" min="0" max="365" value="'+s.cooldownDays+'"></div><div class="setting"><label>正文最少字数</label><input id="minBodyChars" type="number" min="0" max="1000" value="'+s.minBodyChars+'"></div><div class="checks"><label><input id="excludeResolved" type="checkbox" '+(s.excludeResolved?'checked':'')+'> 排除 resolved</label><label><input id="excludeDigested" type="checkbox" '+(s.excludeDigested?'checked':'')+'> 排除 digested</label><label><input id="autoInvitationEnabled" type="checkbox" '+(s.autoInvitationEnabled?'checked':'')+'> 允许自动邀请</label></div><div class="setting"><label>安静多久后可邀请（分钟）</label><input id="invitationIdleMinutes" type="number" min="15" max="1440" value="'+s.invitationIdleMinutes+'"></div><p class="status">自动邀请不会代替你或角色发送隐藏消息。它只会在下一条真实消息到来时，给固定窗口的角色一个可自行判断的邀请时机。</p><div class="actions"><button class="btn quiet" data-act="settings">保存设置</button><button class="btn" data-act="install-workflow">'+(workflow?'确认工作流启用':'启用自动邀请')+'</button></div><p class="status">'+(workflow?'自动邀请工作流已安装。':'自动邀请尚未安装工作流。')+'</p><p class="status">设置从下一本书开始生效。读取到 '+state.sourceCount+' 条原始记忆'+(state.sourceErrors?'，'+state.sourceErrors+' 个文件未能解析':'')+'。</p><p class="status">扫描位置：<br>'+roots+'</p></details>'}
function bind(){document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>{view=el.dataset.view;render()});document.querySelectorAll('[data-act]').forEach(el=>el.onclick=()=>{const a=el.dataset.act;if(a==='accept')bridge('accept');if(a==='skip')bridge('skip');if(a==='assistant-pick')bridge('chooseAssistant');if(a==='user-pick')bridge('chooseUser',{page:Number(document.getElementById('userPage').value)});if(a==='return-chat')bridge('returnToChat');if(a==='install-workflow')bridge('installWorkflow');if(a==='settings')bridge('saveSettings',{chatBinding:document.getElementById('chatBinding').value,fixedChatId:document.getElementById('fixedChatId').value,maxPages:Number(document.getElementById('maxPages').value),cooldownDays:Number(document.getElementById('cooldownDays').value),minBodyChars:Number(document.getElementById('minBodyChars').value),excludeResolved:document.getElementById('excludeResolved').checked,excludeDigested:document.getElementById('excludeDigested').checked,autoInvitationEnabled:document.getElementById('autoInvitationEnabled').checked,invitationIdleMinutes:Number(document.getElementById('invitationIdleMinutes').value)})});document.querySelectorAll('[data-note]').forEach(el=>el.onclick=()=>{const id=el.dataset.note;bridge('addUserNote',{memoryId:id,content:document.getElementById('note_'+id).value})});document.querySelectorAll('[data-role-note]').forEach(el=>el.onclick=()=>bridge('askAssistantNote',{memoryId:el.dataset.roleNote}))}
window.MemoirsApp={setState:function(next){state=next;render()},fail:function(message){state.generating=false;render();showError(message)}};
bridge('ready');
</script></body></html>`;
}
