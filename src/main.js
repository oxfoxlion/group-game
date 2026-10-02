import { io } from 'socket.io-client';

const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const connectionEl = document.querySelector('#connection');
const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';
const socket = io(socketUrl, { autoConnect: false, path: '/group-game/socket.io', transports: ['websocket', 'polling'] });

const saved = JSON.parse(localStorage.getItem('same-frequency-player') || '{}');
const state = {
  playerId: saved.playerId || crypto.randomUUID(),
  nickname: saved.nickname || '',
  room: null,
  selected: null,
  questions: [],
  screen: 'welcome',
};
localStorage.setItem('same-frequency-player', JSON.stringify({ playerId: state.playerId, nickname: state.nickname }));

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function persistProfile() {
  localStorage.setItem('same-frequency-player', JSON.stringify({ playerId: state.playerId, nickname: state.nickname }));
}

async function loadQuestions() {
  const response = await fetch('/questions.md');
  if (!response.ok) throw new Error(`題庫讀取失敗：HTTP ${response.status}`);
  const markdown = await response.text();
  state.questions = [...markdown.matchAll(/^##\s+(.+)\n+([^\n]+)/gm)].map((match) => {
    const [left = '完全不會', right = '非常可能'] = match[2].split('｜').map((part) => part.replace(/^(左|右)：/, '').trim());
    return { text: match[1].trim(), left, right };
  }).slice(0, 10);
  if (!state.questions.length) throw new Error('題庫中沒有符合格式的題目');
}

function connectAnd(action) {
  if (!socket.connected) socket.connect();
  if (socket.connected) action();
  else socket.once('connect', action);
}

function emitAck(event, payload, onSuccess) {
  socket.timeout(5000).emit(event, payload, (error, response) => {
    if (error) return toast('伺服器沒有回應，請再試一次');
    if (!response?.ok) return toast(response?.message || '操作沒有成功');
    onSuccess?.(response);
  });
}

function enterRoom(room) {
  state.room = room;
  state.screen = room.phase === 'lobby' ? 'lobby' : room.phase;
  state.selected = room.players.find((p) => p.id === state.playerId)?.answer ?? null;
  history.replaceState({}, '', `?room=${room.code}`);
  render();
}

function profileMarkup(title, subtitle) {
  return `<section class="entry-shell">
    <div class="intro">
      <p class="eyebrow">1–10 的距離，剛好認識一個人</p>
      <h1>${title}</h1>
      <p>${subtitle}</p>
      <div class="demo-scale" aria-hidden="true"><b>1</b><span></span><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><b>10</b></div>
    </div>
    <form id="profile-form" class="paper-card">
      <label for="nickname">大家怎麼叫你？</label>
      <input id="nickname" name="nickname" maxlength="16" autocomplete="nickname" placeholder="輸入暱稱" value="${escapeHtml(state.nickname)}" autofocus required />
      <button class="primary" type="submit">繼續 <span>→</span></button>
      <small>不用註冊。暱稱只會留在這台裝置。</small>
    </form>
  </section>`;
}

function renderWelcome() {
  app.innerHTML = profileMarkup('最近如何?<br><em>一起研究吧！</em>', '沒有標準答案。選一個刻度，用問題認識朋友。');
  document.querySelector('#profile-form').addEventListener('submit', (event) => {
    event.preventDefault();
    state.nickname = new FormData(event.currentTarget).get('nickname').trim();
    if (!state.nickname) return;
    persistProfile();
    state.screen = 'home';
    render();
    const inviteCode = new URLSearchParams(location.search).get('room');
    if (inviteCode) joinRoom(inviteCode);
  });
}

function renderHome() {
  const inviteCode = new URLSearchParams(location.search).get('room');
  app.innerHTML = `<section class="home-shell">
    <div class="hello"><p class="eyebrow">嗨，${escapeHtml(state.nickname)}</p><h1>${inviteCode ? '朋友正在等你' : '最近如何？'}</h1><p>${inviteCode ? `加入房間 ${escapeHtml(inviteCode)}，準備好就能開始。` : '每題 10 秒的最近如何快問快答，一起來問問自己：最近如何?'}</p></div>
    <div class="action-grid">
      ${inviteCode ? `<button id="join-invite" class="choice-card coral"><span class="choice-icon">↗</span><b>加入 ${escapeHtml(inviteCode)}</b><small>使用邀請連結進入</small></button>` : ''}
      <button id="create-room" class="choice-card violet"><span class="choice-icon">＋</span><b>開新房間</b><small>你會成為房主</small></button>
      <form id="join-form" class="choice-card form-card"><label for="room-code">輸入房號</label><div><input id="room-code" maxlength="4" placeholder="ABCD" autocapitalize="characters" required /><button aria-label="加入房間">→</button></div><small>四個英文字母</small></form>
    </div>
    <button id="change-name" class="text-button">不是 ${escapeHtml(state.nickname)}？更換暱稱</button>
  </section>`;
  document.querySelector('#create-room').onclick = () => connectAnd(() => emitAck('room:create', { playerId: state.playerId, nickname: state.nickname, questionCount: state.questions.length }, ({ room }) => enterRoom(room)));
  document.querySelector('#join-form').onsubmit = (event) => { event.preventDefault(); joinRoom(document.querySelector('#room-code').value); };
  document.querySelector('#join-invite')?.addEventListener('click', () => joinRoom(inviteCode));
  document.querySelector('#change-name').onclick = () => { state.screen = 'welcome'; render(); };
}

function joinRoom(code) {
  connectAnd(() => emitAck('room:join', { code: code.trim().toUpperCase(), playerId: state.playerId, nickname: state.nickname }, ({ room }) => enterRoom(room)));
}

function playerCards() {
  return state.room.players.map((player) => `<li class="player ${player.ready ? 'ready' : ''}"><span class="avatar" style="--h:${hashHue(player.id)}">${escapeHtml(player.nickname[0])}</span><div><b>${escapeHtml(player.nickname)}</b><small>${player.id === state.room.hostId ? '房主' : player.ready ? '準備好了' : '還在暖身'}</small></div><i>${player.ready ? '✓' : '…'}</i></li>`).join('');
}

function renderLobby() {
  const me = state.room.players.find((p) => p.id === state.playerId);
  const isHost = state.room.hostId === state.playerId;
  const allReady = state.room.players.length >= 2 && state.room.players.every((p) => p.ready || p.id === state.room.hostId);
  app.innerHTML = `<section class="room-shell">
    <div class="room-top"><div><p class="eyebrow">房間代碼</p><button id="copy-code" class="room-code">${state.room.code} <span>複製</span></button></div><div class="room-note"><b>${state.room.players.length}</b><span>位玩家已經入座</span></div></div>
    <div class="lobby-grid"><div><h1>等大家進來就開始</h1><p>全員準備後，房主就可以開始。每題只有 10 秒，憑直覺回答。</p></div><div class="player-panel"><div class="panel-title"><span>玩家</span><span>${state.room.players.filter(p => p.ready).length}/${state.room.players.length} 準備</span></div><ul>${playerCards()}</ul></div></div>
    <div class="sticky-actions">
      ${isHost ? `<button id="start-game" class="primary" ${allReady ? '' : 'disabled'}>${allReady ? '開始遊戲' : state.room.players.length < 2 ? '再等一位玩家' : '等待所有人準備'}</button>` : `<button id="ready" class="primary ${me?.ready ? 'is-ready' : ''}">${me?.ready ? '取消準備' : '我準備好了'}</button>`}
      <button id="leave" class="text-button">離開房間</button>
    </div>
  </section>`;
  document.querySelector('#copy-code').onclick = async () => { await navigator.clipboard.writeText(`${location.origin}?room=${state.room.code}`); toast('邀請連結已複製'); };
  document.querySelector('#ready')?.addEventListener('click', () => socket.emit('room:ready'));
  document.querySelector('#start-game')?.addEventListener('click', () => emitAck('game:start', {}, null));
  document.querySelector('#leave').onclick = () => { socket.emit('room:leave'); state.room = null; state.screen = 'home'; history.replaceState({}, '', '/'); render(); };
}

function renderQuestion() {
  const q = state.questions[state.room.questionIndex] || { text: '這一題，你會選幾分？', left: '完全不會', right: '非常可能' };
  const answered = state.room.players.filter((p) => p.answered).length;
  app.innerHTML = `<section class="game-shell">
    <div class="game-meta"><span>第 ${state.room.questionIndex + 1} 題／共 ${state.room.questionCount} 題</span><div class="timer"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19"></circle><circle id="timer-ring" cx="22" cy="22" r="19"></circle></svg><b id="seconds">10</b></div><span><b id="answered-count">${answered}</b>/${state.room.players.length} 已作答</span></div>
    <div class="question-card"><span class="quote">“</span><h1>${escapeHtml(q.text)}</h1></div>
    <div class="scale-wrap"><div class="scale-labels"><span>${escapeHtml(q.left)}</span><span>${escapeHtml(q.right)}</span></div><div class="number-scale">${Array.from({ length: 10 }, (_, i) => `<button data-score="${i + 1}" class="${state.selected === i + 1 ? 'selected' : ''}"><i></i><b>${i + 1}</b></button>`).join('')}</div><p id="answer-hint">${state.selected ? `目前選擇 ${state.selected}，倒數結束前都可以修改。` : '選一個最符合你現在感受的數字。'}</p></div>
  </section>`;
  document.querySelectorAll('[data-score]').forEach((button) => button.onclick = () => { state.selected = Number(button.dataset.score); socket.emit('game:answer', { score: state.selected }); renderQuestion(); });
  updateTimer();
}

function updateTimer() {
  if (state.screen !== 'question' || !state.room) return;
  const left = Math.max(0, state.room.deadline - Date.now());
  const seconds = Math.ceil(left / 1000);
  const el = document.querySelector('#seconds');
  const ring = document.querySelector('#timer-ring');
  if (el) el.textContent = seconds;
  if (ring) ring.style.strokeDashoffset = 119.4 * (1 - left / 10000);
  if (left > 0) requestAnimationFrame(updateTimer);
}

function renderResult() {
  const q = state.questions[state.room.questionIndex] || {};
  const isRevealed = state.room.revealed;
  const counts = state.room.resultCounts || [];
  const unansweredCount = state.room.unansweredCount || 0;
  const featured = state.room.featuredResult;
  const isHost = state.room.hostId === state.playerId;

  if (!isRevealed) {
    app.innerHTML = `<section class="result-shell anonymous-result">
      <p class="eyebrow">匿名統計</p><h1>${escapeHtml(q.text)}</h1>
      <div class="result-scale-guide"><span><b>1 分</b>${escapeHtml(q.left || '低')}</span><i aria-hidden="true"></i><span><b>10 分</b>${escapeHtml(q.right || '高')}</span></div>
      <p class="result-intro">大家都選完了，先看看分數分布。</p>
      <div class="score-counts">${counts.length ? counts.map(({ score, count }) => `<article><b>${score}</b><span>分</span><strong>${count} 位</strong></article>`).join('') : '<p class="waiting-copy">這題沒有人完成作答。</p>'}</div>
      ${unansweredCount ? `<p class="unanswered-note">另有 ${unansweredCount} 位未作答</p>` : ''}
      <div class="sticky-actions">${isHost ? '<button id="reveal" class="primary">揭曉大家的選擇</button>' : '<p class="waiting-copy">等待房主揭曉答案…</p>'}</div>
    </section>`;
    document.querySelector('#reveal')?.addEventListener('click', () => socket.emit('game:reveal'));
    return;
  }

  const results = [...state.room.results].sort((a, b) => {
    if (a.score == null && b.score == null) return 0;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return b.score - a.score;
  });
  app.innerHTML = `<section class="result-shell">
    <p class="eyebrow">第 ${state.room.questionIndex + 1} 題揭曉</p><h1>${escapeHtml(q.text)}</h1>
    <div class="result-scale-guide"><span><b>1 分</b>${escapeHtml(q.left || '低')}</span><i aria-hidden="true"></i><span><b>10 分</b>${escapeHtml(q.right || '高')}</span></div>
    ${featured ? `<article class="featured-answer"><span class="crown" aria-hidden="true">♛</span><div><small>這題請${featured.players.length > 1 ? '你們' : '你'}分享</small><h2>${featured.players.map((player) => escapeHtml(player.nickname)).join('、')}</h2><p>${featured.players.length > 1 ? '你們都' : '你'}選了 <b>${featured.score} 分</b>，為什麼是這個數字？</p></div></article>` : '<p class="no-featured">這題沒有一人或兩人選擇的數字，大家自由分享吧！</p>'}
    <div class="revealed-answers">${results.length ? results.map((result) => `<article class="answer-row ${featured?.players.some((player) => player.id === result.id) ? 'is-featured' : ''} ${result.score == null ? 'is-unanswered' : ''}"><span class="avatar" style="--h:${hashHue(result.id)}">${escapeHtml(result.nickname[0])}</span><b>${escapeHtml(result.nickname)}</b><strong>${result.score == null ? '未作答' : `${result.score} 分`}</strong></article>`).join('') : '<p class="waiting-copy">這題沒有玩家。</p>'}</div>
    <div class="sticky-actions">${isHost ? `<button id="next" class="primary">${state.room.questionIndex + 1 >= state.room.questionCount ? '看遊戲總結' : '下一題'} <span>→</span></button>` : '<p class="waiting-copy">等房主帶大家進入下一題…</p>'}</div>
  </section>`;
  document.querySelector('#next')?.addEventListener('click', () => socket.emit('game:next'));
}

function renderFinished() {
  app.innerHTML = `<section class="finish-shell"><p class="eyebrow">今晚的頻率報告</p><h1>沒有標準答案，<br>但你們更認識彼此了。</h1><div class="big-mark">↝</div><p>共完成 ${state.room.questionCount} 題。最有趣的答案，留給你們現在聊。</p><button id="again" class="primary">回到首頁</button></section>`;
  document.querySelector('#again').onclick = () => { socket.emit('room:leave'); state.room = null; state.screen = 'home'; history.replaceState({}, '', '/'); render(); };
}

function hashHue(value) {
  return ([...value].reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0) >>> 0) % 360;
}
function render() { ({ welcome: renderWelcome, home: renderHome, lobby: renderLobby, question: renderQuestion, result: renderResult, finished: renderFinished }[state.screen] || renderHome)(); }

socket.on('connect', () => { connectionEl.classList.add('online'); connectionEl.querySelector('span').textContent = '已連線'; });
socket.on('disconnect', () => { connectionEl.classList.remove('online'); connectionEl.querySelector('span').textContent = '重新連線中'; });
socket.on('room:update', (room) => enterRoom(room));
socket.on('game:question', (room) => { state.selected = null; enterRoom(room); });
socket.on('game:result', (room) => enterRoom(room));
socket.on('game:reveal', (room) => enterRoom(room));
socket.on('game:finished', (room) => enterRoom(room));
socket.on('room:closed', ({ message }) => { toast(message); state.room = null; state.screen = 'home'; history.replaceState({}, '', '/'); render(); });

await loadQuestions().catch(() => { state.questions = []; toast('題庫讀取失敗'); });
state.screen = state.nickname ? 'home' : 'welcome';
render();
const initialInviteCode = new URLSearchParams(location.search).get('room');
if (state.nickname && initialInviteCode) joinRoom(initialInviteCode);
