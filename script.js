/* =====================================================================
   BLUFF — HTML + CSS + JS puros
   - Modo Local: você contra o computador (2, 3 ou 4 jogadores)
   - Modo Online: salas por código (WebRTC via PeerJS, sem servidor próprio)
   Regras: Truco Paulista (baralho de 40 cartas, manilha definida pela vira)
   ===================================================================== */
'use strict';

/* ---------------------------------------------------------------------
   1. CARTAS
   --------------------------------------------------------------------- */
const RANKS = ['4','5','6','7','Q','J','K','A','2','3']; // fraca -> forte
const SUITS = ['♦','♠','♥','♣'];                          // ordem das manilhas (♣ é o zap)
const NEXT  = {1:3, 3:6, 6:9, 9:12};
const LABEL = {3:'TRUCO', 6:'SEIS', 9:'NOVE', 12:'DOZE'};
const PREFIX = 'bluffdglab-';
// STUN/TURN: ajuda a conectar celular <-> computador mesmo em redes diferentes (4G, Wi-Fi, etc.)
const PEER_OPTS = {
  debug:0,
  config:{ iceServers:[
    {urls:'stun:stun.l.google.com:19302'},
    {urls:'stun:stun1.l.google.com:19302'},
    {urls:'stun:global.stun.twilio.com:3478'},
    {urls:'turn:openrelay.metered.ca:80',username:'openrelayproject',credential:'openrelayproject'},
    {urls:'turn:openrelay.metered.ca:443',username:'openrelayproject',credential:'openrelayproject'},
    {urls:'turn:openrelay.metered.ca:443?transport=tcp',username:'openrelayproject',credential:'openrelayproject'}
  ]}
};

function newDeck(){
  const d=[];
  for(let r=0;r<10;r++) for(let s=0;s<4;s++) d.push({r,s});
  for(let i=d.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [d[i],d[j]]=[d[j],d[i]]; }
  return d;
}
const strength = (c,man)=> c.r===man ? 100+c.s : c.r;

/* ---------------------------------------------------------------------
   2. ENGINE (roda só no anfitrião / no modo local)
   --------------------------------------------------------------------- */
class Engine{
  constructor(seats){
    this.seats = seats;            // [{name, avatar}]
    this.n = seats.length;
    this.nTeams = this.n===4 ? 2 : this.n;
    this.scores = Array(this.nTeams).fill(0);
    this.dealer = this.n-1;
    this.msgId = 0; this.msg = null; this.handNo = 0;
    this.startHand();
  }
  team(s){ return this.n===4 ? s%2 : s; }
  teamSeats(t){ return [...Array(this.n).keys()].filter(s=>this.team(s)===t); }
  nextOpp(seat){ for(let k=1;k<this.n;k++){ const s=(seat+k)%this.n; if(this.team(s)!==this.team(seat)) return s; } return seat; }
  announce(m){ this.msg = {...m, id:++this.msgId}; }

  startHand(){
    const d = newDeck();
    this.hands = []; for(let i=0;i<this.n;i++) this.hands.push([d.pop(),d.pop(),d.pop()]);
    this.vira = d.pop();
    this.manilha = (this.vira.r+1)%10;
    this.dealer = (this.dealer+1)%this.n;
    this.leader = (this.dealer+1)%this.n;
    this.turn = this.leader;
    this.table = []; this.roundWins = [];
    this.value = 1; this.lastRaiser = null; this.pending = null; this.respSeat = null;
    this.noTruco = false; this.handWinner = null; this.gameWinner = null;
    this.stage = 'turn'; this.elevenSeat = null; this.elevenTeam = null; this.nextLeader = this.leader;
    this.handNo++;
    // Mão de 11 / mão de ferro (só com 2 times)
    if(this.nTeams===2){
      const a = this.scores[0]===11, b = this.scores[1]===11;
      if(a && b){ this.noTruco = true; this.announce({k:'iron'}); }
      else if(a || b){
        const t = a?0:1;
        this.noTruco = true; this.stage = 'eleven'; this.elevenTeam = t; this.elevenSeat = this.teamSeats(t)[0];
        this.announce({k:'eleven', team:t});
      }
    }
  }

  canCallTruco(seat){
    return this.stage==='turn' && this.turn===seat && !this.noTruco && this.value<12 &&
           this.team(seat)!==this.lastRaiser;
  }
  decider(){
    if(this.stage==='turn') return this.turn;
    if(this.stage==='truco') return this.respSeat;
    if(this.stage==='eleven') return this.elevenSeat;
    return null;
  }

  act(seat, a){
    switch(this.stage){
      case 'turn':
        if(seat!==this.turn) return false;
        if(a.type==='play'){
          const h = this.hands[seat]; const c = h[a.i]; if(!c) return false;
          h.splice(a.i,1); this.table.push({seat, card:c});
          if(this.table.length===this.n) this.resolveRound(); else this.turn = (this.turn+1)%this.n;
          return true;
        }
        if(a.type==='truco' && this.canCallTruco(seat)){
          const to = NEXT[this.value];
          this.pending = {from:seat, to}; this.respSeat = this.nextOpp(seat); this.stage = 'truco';
          this.announce({k:'truco', seat, to});
          return true;
        }
        return false;

      case 'truco':
        if(seat!==this.respSeat) return false;
        if(a.type==='accept'){
          this.value = this.pending.to; this.lastRaiser = this.team(this.pending.from);
          this.pending = null; this.respSeat = null; this.stage = 'turn';
          this.announce({k:'accept', seat});
          return true;
        }
        if(a.type==='run'){
          this.announce({k:'run', seat});
          const winner = this.team(this.pending.from);
          this.pending = null; this.respSeat = null;
          this.endHand(winner, this.value, 'run');
          return true;
        }
        if(a.type==='raise' && this.pending.to<12){
          this.value = this.pending.to;
          const to = NEXT[this.value];
          this.pending = {from:seat, to}; this.respSeat = this.nextOpp(seat);
          this.announce({k:'truco', seat, to});
          return true;
        }
        return false;

      case 'eleven':
        if(seat!==this.elevenSeat) return false;
        if(a.type==='accept'){ this.value = 3; this.stage = 'turn'; this.announce({k:'elevenPlay', team:this.elevenTeam}); return true; }
        if(a.type==='run'){ this.endHand(1-this.elevenTeam, 1, 'run'); return true; }
        return false;
    }
    return false;
  }

  resolveRound(){
    let best = -1;
    this.table.forEach(t=>{ best = Math.max(best, strength(t.card,this.manilha)); });
    const top = this.table.filter(t=>strength(t.card,this.manilha)===best);
    const teams = new Set(top.map(t=>this.team(t.seat)));
    const w = teams.size===1 ? top[0].seat : null;
    this.roundWins.push({seat:w, team: w===null?null:this.team(w)});
    this.lastWinSeat = w;
    this.nextLeader = w!==null ? w : this.table[0].seat;
    if(!this.checkHand()) this.stage = 'between';
  }

  checkHand(){
    const rw = this.roundWins;
    const cnt = Array(this.nTeams).fill(0);
    rw.forEach(r=>{ if(r.team!==null) cnt[r.team]++; });
    let win = cnt.findIndex(c=>c>=2);
    if(win<0 && rw.length===2){
      const [a,b] = rw;
      if(a.team===null && b.team!==null) win = b.team;
      else if(a.team!==null && b.team===null) win = a.team;
    }
    if(win<0 && rw.length===3){
      if(rw[2].team!==null) win = rw[2].team;
      else { const f = rw.find(r=>r.team!==null); win = f ? f.team : -1; }
      if(win<0){ this.endHand(null,0,'draw'); return true; }
    }
    if(win>=0){ this.endHand(win, this.value, 'win'); return true; }
    return false;
  }

  endHand(team, pts, how){
    this.stage = 'handOver'; this.handWinner = team; this.pending = null; this.respSeat = null;
    if(team!==null) this.scores[team] = Math.min(12, this.scores[team]+pts);
    this.announce({k:'hand', team, pts, how});
    if(team!==null && this.scores[team]>=12){ this.stage = 'gameOver'; this.gameWinner = team; }
  }

  continueRound(){ this.table = []; this.turn = this.nextLeader; this.stage = 'turn'; }
  nextHand(){ this.startHand(); }

  view(seat){
    const v = {
      n:this.n, seat, stage:this.stage, turn:this.turn, dealer:this.dealer,
      scores:this.scores.slice(), nTeams:this.nTeams,
      teams:this.seats.map((_,i)=>this.team(i)),
      names:this.seats.map(s=>s.name), avatars:this.seats.map(s=>s.avatar),
      vira:this.vira, manilha:this.manilha,
      hand:this.hands[seat].slice(), counts:this.hands.map(h=>h.length),
      table:this.table.map(t=>({seat:t.seat, card:t.card})),
      rw:this.roundWins.map(r=>r.team), lastWinSeat:this.lastWinSeat,
      value:this.value, pending:this.pending, respSeat:this.respSeat,
      noTruco:this.noTruco, canTruco:this.canCallTruco(seat),
      elevenSeat:this.elevenSeat, elevenTeam:this.elevenTeam,
      msg:this.msg, handWinner:this.handWinner, gameWinner:this.gameWinner, handNo:this.handNo
    };
    if(this.stage==='eleven' && seat===this.elevenSeat){
      v.partner = this.teamSeats(this.elevenTeam).filter(s=>s!==seat).map(s=>({seat:s, cards:this.hands[s].slice()}));
    }
    return v;
  }
}

/* ---------------------------------------------------------------------
   3. BOT (computador)
   --------------------------------------------------------------------- */
function cardScore(c,man){
  if(c.r===man) return 0.9 + c.s*0.034;
  return [0.05,0.05,0.05,0.1,0.2,0.25,0.35,0.5,0.65,0.75][c.r];
}
function handStrength(hand,man){
  if(!hand.length) return 0;
  const sc = hand.map(c=>cardScore(c,man)).sort((a,b)=>b-a);
  const top = sc.slice(0,2);
  let v = top.reduce((a,b)=>a+b,0)/top.length;
  if(sc.filter(x=>x>=0.9).length>=2) v = 1;
  return v;
}
function botAct(e, seat){
  const h = e.hands[seat], man = e.manilha;
  const hs = handStrength(h,man) + (Math.random()*0.16-0.08);
  if(e.stage==='eleven') return {type: hs>0.5 ? 'accept' : 'run'};
  if(e.stage==='truco'){
    const to = e.pending.to;
    const need = 0.3 + (to/12)*0.35;
    if(hs>0.88 && to<12 && Math.random()<0.5) return {type:'raise'};
    if(hs>=need || Math.random()<0.14) return {type:'accept'};
    return {type:'run'};
  }
  if(e.canCallTruco(seat) && ((hs>0.8 && Math.random()<0.35) || (hs<0.3 && Math.random()<0.05))) return {type:'truco'};

  const idx = h.map((_,i)=>i).sort((a,b)=>strength(h[a],man)-strength(h[b],man)); // crescente
  const mine = e.team(seat);
  if(e.table.length>0){
    const best = e.table.reduce((m,t)=>strength(t.card,man)>strength(m.card,man)?t:m);
    if(e.team(best.seat)===mine) return {type:'play', i:idx[0]};
    const win = idx.filter(i=>strength(h[i],man)>strength(best.card,man));
    return {type:'play', i: win.length ? win[0] : idx[0]};
  }
  if(e.roundWins.length===0){
    const r = Math.random();
    if(idx.length===3) return {type:'play', i: r<0.55 ? idx[2] : r<0.8 ? idx[1] : idx[0]};
  }
  return {type:'play', i: idx[idx.length-1]};
}

/* ---------------------------------------------------------------------
   4. ANFITRIÃO (dono da partida: local ou sala online)
   --------------------------------------------------------------------- */
const BOT_NAMES = ['Torradeira','Robozão','Dr. Bip','Cartola','Mestre Zap'];
const BOT_AVATARS = ['🤖','🦾','👾','🧠','🎩'];
const HUMAN_AVATARS = ['😎','🦊','🐯','🐸','🦁','🐼'];

class Host{
  constructor(mode,size){
    this.mode = mode;                   // 'local' | 'online'
    this.size = size;
    this.slots = Array(size).fill(null); // {name, avatar, bot, conn}
    this.engine = null; this.timer = null; this.started = false;
  }
  addHuman(seat,name,avatar,conn){ this.slots[seat] = {name,avatar,bot:false,conn}; }
  addBot(){
    const i = this.slots.findIndex(s=>!s); if(i<0) return false;
    const used = this.slots.filter(s=>s&&s.bot).length;
    this.slots[i] = {name:BOT_NAMES[used%BOT_NAMES.length], avatar:BOT_AVATARS[used%BOT_AVATARS.length], bot:true, conn:null};
    return true;
  }
  lobbyData(forSeat){
    return {t:'lobby', size:this.size, you:forSeat, code:NET.code,
      seats:this.slots.map(s=>s?{name:s.name,avatar:s.avatar,bot:s.bot}:null), started:this.started};
  }
  sendLobby(){
    this.slots.forEach((s,i)=>{
      if(!s||s.bot) return;
      if(i===0) UI.renderLobby(this.lobbyData(0));
      else if(s.conn && s.conn.open) s.conn.send(this.lobbyData(i));
    });
  }
  start(){
    while(this.addBot()){}
    this.started = true;
    this.newEngine();
  }
  newEngine(){
    this.engine = new Engine(this.slots.map(s=>({name:s.name, avatar:s.avatar})));
    this.broadcast(); this.schedule();
  }
  broadcast(){
    // Cada envio é isolado: um erro de desenho ou de rede em um jogador não pode travar os outros nem a partida.
    this.slots.forEach((s,i)=>{
      if(!s||s.bot) return;
      try{
        const v = this.engine.view(i);
        if(i===0) UI.onView(v);
        else if(s.conn && s.conn.open) s.conn.send({t:'state', v});
      }catch(err){ console.error('broadcast', err); }
    });
  }
  sendState(seat){
    // Reenvia o estado atual para um jogador (usado para ressincronizar telas desatualizadas)
    const s = this.slots[seat]; if(!s||s.bot||!this.engine) return;
    try{
      const v = this.engine.view(seat);
      if(seat===0) UI.onView(v);
      else if(s.conn && s.conn.open) s.conn.send({t:'state', v});
    }catch(err){ console.error('sendState', err); }
  }
  relay(msg){
    this.slots.forEach((s,i)=>{
      if(!s||s.bot||i===0) return;
      try{ if(s.conn && s.conn.open) s.conn.send(msg); }catch(err){}
    });
    UI.onReaction(msg.seat, msg.text);
  }
  dispatch(seat, a){
    if(!this.engine || !a) return;
    let ok = false;
    try{ ok = this.engine.act(seat,a); }catch(err){ console.error('act', err); }
    if(ok){
      try{ this.broadcast(); } finally { this.schedule(); }
    } else {
      // Ação recusada (tela desatualizada, clique atrasado...): manda o estado real para o jogador não ficar travado
      this.sendState(seat);
    }
  }
  botFallback(e,d){
    // Se o computador escolher uma jogada inválida, faz uma jogada segura em vez de travar a mesa
    try{
      if(e.stage==='turn') return e.act(d,{type:'play', i:0});
      return e.act(d,{type:'accept'});
    }catch(err){ return false; }
  }
  schedule(){
    clearTimeout(this.timer);
    const e = this.engine; if(!e) return;
    if(e.stage==='between'){ this.timer = setTimeout(()=>{ e.continueRound(); this.broadcast(); this.schedule(); }, 1500); return; }
    if(e.stage==='handOver'){ this.timer = setTimeout(()=>{ e.nextHand(); this.broadcast(); this.schedule(); }, 3200); return; }
    if(e.stage==='gameOver') return;
    const d = e.decider(); if(d===null) return;
    const slot = this.slots[d];
    if(slot && slot.bot){
      this.timer = setTimeout(()=>{
        if(this.engine!==e || e.decider()!==d){ this.schedule(); return; }
        let a = null, ok = false;
        try{ a = botAct(e,d); ok = e.act(d,a); }catch(err){ console.error('bot', err); }
        if(!ok){ a = null; ok = this.botFallback(e,d); }
        try{
          if(ok && a && (a.type==='truco'||a.type==='raise')) this.relay({t:'emo', seat:d, text:'Truco!'});
          if(ok) this.broadcast();
        } finally { this.schedule(); }
      }, 900 + Math.random()*900);
    }
  }
  playerLeft(seat){
    const s = this.slots[seat]; if(!s) return;
    if(!this.started){ this.slots[seat] = null; this.sendLobby(); return; }
    s.bot = true; s.conn = null; s.name += ' (bot)';
    if(this.engine) this.engine.seats[seat].name = s.name;
    this.broadcast(); this.schedule();
  }
  onMessage(conn, m){
    const seat = conn._seat;
    if(m.t==='join'){
      if(this.started) return conn.send({t:'err', m:'A partida desta sala já começou.'});
      const i = this.slots.findIndex(s=>!s);
      if(i<0) return conn.send({t:'err', m:'Sala cheia.'});
      conn._seat = i;
      this.addHuman(i, String(m.name||'Jogador').slice(0,14), String(m.avatar||'🙂').slice(0,4), conn);
      this.sendLobby();
    }
    else if(m.t==='act' && seat!=null){ this.dispatch(seat, m.a); }
    else if(m.t==='emo' && seat!=null){ this.relay({t:'emo', seat, text:String(m.text).slice(0,30)}); }
    else if(m.t==='sync' && seat!=null){ this.sendState(seat); }
    else if(m.t==='again' && seat!=null){ /* só o anfitrião reinicia */ }
  }
  kick(seat){
    const s = this.slots[seat]; if(!s||seat===0) return;
    if(s.conn){ try{ s.conn.send({t:'err', m:'Você foi removido da sala.'}); s.conn.close(); }catch(e){} }
    this.slots[seat] = null; this.sendLobby();
  }
  destroy(){
    clearTimeout(this.timer);
    this.slots.forEach(s=>{ if(s&&s.conn){ try{ s.conn.send({t:'end'}); s.conn.close(); }catch(e){} } });
  }
}

/* ---------------------------------------------------------------------
   5. REDE (PeerJS)
   --------------------------------------------------------------------- */
const NET = { role:null, host:null, peer:null, conn:null, code:null, seat:0 };

function randCode(){
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c='';
  for(let i=0;i<5;i++) c += abc[Math.floor(Math.random()*abc.length)];
  return c;
}
function peerReady(){
  if(typeof Peer==='undefined'){ UI.status('online-status','Não foi possível carregar a biblioteca online. Verifique sua internet.'); return false; }
  return true;
}
function createRoom(name,size,attempt=0){
  if(!peerReady()) return;
  UI.status('online-status','Criando sala…');
  const code = randCode();
  const peer = new Peer(PREFIX+code, PEER_OPTS);
  let opened = false;
  peer.on('open', ()=>{
    opened = true;
    NET.role='host'; NET.peer=peer; NET.code=code; NET.seat=0;
    NET.host = new Host('online', size);
    NET.host.addHuman(0, name, UI.myAvatar(), null);
    UI.show('lobby');
    NET.host.sendLobby();
  });
  peer.on('connection', conn=>{
    conn.on('data', m=>NET.host && NET.host.onMessage(conn,m));
    conn.on('close', ()=>{ if(NET.host && conn._seat!=null) NET.host.playerLeft(conn._seat); });
    conn.on('error', ()=>{});
  });
  peer.on('error', err=>{
    if(err.type==='unavailable-id' && attempt<4){ peer.destroy(); return createRoom(name,size,attempt+1); }
    if(!opened) UI.status('online-status','Não foi possível criar a sala ('+err.type+'). Tente de novo.');
  });
  peer.on('disconnected', ()=>{ try{ peer.reconnect(); }catch(e){} });
}
function joinRoom(code,name){
  if(!peerReady()) return;
  code = code.trim().toUpperCase();
  if(code.length!==5) return UI.status('online-status','Digite o código de 5 letras da sala.');
  UI.status('online-status','Conectando à sala…');
  const peer = new Peer(PEER_OPTS);
  let done = false;
  const fail = msg=>{ if(done) return; done = true; UI.status('online-status',msg); try{peer.destroy();}catch(e){} };
  const timeout = setTimeout(()=>fail('Não foi possível conectar. Confira o código e tente novamente.'), 20000);
  peer.on('open', ()=>{
    const conn = peer.connect(PREFIX+code, {serialization:'json', reliable:true});
    conn.on('open', ()=>{
      NET.role='client'; NET.peer=peer; NET.conn=conn; NET.code=code; NET.lastRx=Date.now();
      conn.send({t:'join', name, avatar:UI.myAvatar()});
      // Batimento: pede o estado atual a cada 5s. Mantém a conexão viva e corrige qualquer tela desatualizada.
      clearInterval(NET.ping);
      NET.ping = setInterval(()=>{
        try{ if(conn.open) conn.send({t:'sync'}); }catch(e){}
        if(UI.view && Date.now()-NET.lastRx>20000) UI.toast('Sem resposta do anfitrião… verifique a conexão.');
      }, 5000);
    });
    conn.on('data', m=>{
      NET.lastRx = Date.now();
      if(m.t==='lobby'){ clearTimeout(timeout); done=true; UI.show('lobby'); UI.renderLobby(m); NET.seat=m.you; }
      else if(m.t==='state'){ UI.onView(m.v); }
      else if(m.t==='emo'){ UI.onReaction(m.seat, m.text); }
      else if(m.t==='err'){ clearTimeout(timeout); if(!done) fail(m.m); else { UI.toast(m.m); UI.leave(); } }
      else if(m.t==='end'){ UI.toast('O anfitrião encerrou a sala.'); UI.leave(true); }
    });
    conn.on('close', ()=>{ if(NET.role==='client'){ UI.toast('Conexão com a sala encerrada.'); UI.leave(true); } });
    conn.on('error', ()=>{});
  });
  peer.on('disconnected', ()=>{ try{ peer.reconnect(); }catch(e){} });
  peer.on('error', err=>{
    clearTimeout(timeout);
    fail(err.type==='peer-unavailable' ? 'Sala não encontrada. Confira o código.' : 'Erro de conexão ('+err.type+').');
  });
}
function sendAct(a){
  // evita envio duplicado do mesmo toque (ex.: toque duplo)
  const k = JSON.stringify(a), now = Date.now();
  if(sendAct._k===k && now-sendAct._t<250) return;
  sendAct._k = k; sendAct._t = now;
  if(NET.role==='client'){
    try{
      if(NET.conn && NET.conn.open) NET.conn.send({t:'act', a});
      else UI.toast('Conexão instável… tentando de novo.');
    }catch(e){ UI.toast('Conexão instável… tentando de novo.'); }
  }
  else if(NET.host) NET.host.dispatch(0, a);
}
function sendReaction(text){
  if(NET.role==='client') NET.conn && NET.conn.open && NET.conn.send({t:'emo', text});
  else if(NET.host) NET.host.relay({t:'emo', seat:0, text});
}

/* ---------------------------------------------------------------------
   6. INTERFACE
   --------------------------------------------------------------------- */
const $ = s=>document.querySelector(s);
const $$ = s=>[...document.querySelectorAll(s)];

const UI = {
  view:null, lastMsgId:-1, lastTableKey:new Set(), lastHandNo:-1, bubbles:{}, panel:null, avatar:null,

  /* ---- telas ---- */
  show(name){
    $$('.screen').forEach(s=>s.classList.toggle('active', s.id==='screen-'+name));
    this.closeModal(); this.closePanel();
  },
  toast(t){
    const el=$('#toast'); el.textContent=t; el.classList.add('show');
    clearTimeout(this._tt); this._tt=setTimeout(()=>el.classList.remove('show'),2800);
  },
  status(id,t){ $('#'+id).textContent=t; },
  myAvatar(){
    if(!this.avatar){
      this.avatar = localStorage.getItem('truco_avatar') || HUMAN_AVATARS[Math.floor(Math.random()*HUMAN_AVATARS.length)];
      try{ localStorage.setItem('truco_avatar', this.avatar); }catch(e){}
    }
    return this.avatar;
  },
  savedName(){ try{ return localStorage.getItem('truco_name')||''; }catch(e){ return ''; } },
  saveName(n){ try{ localStorage.setItem('truco_name', n); }catch(e){} },
  // Só mexe no DOM quando o conteúdo mudou de verdade. Redesenhar o mesmo HTML a cada atualização
  // trocava os botões/cartas no meio do toque e o clique se perdia.
  setHTML(el,html){ if(el._h===html) return; el._h=html; el.innerHTML=html; },
  closeModal(){ const m=$('#modal'); m.classList.add('hidden'); m.innerHTML=''; },
  modal(html){ const m=$('#modal'); m.innerHTML='<div class="mbox">'+html+'</div>'; m.classList.remove('hidden'); },

  leave(toMenu=true){
    clearInterval(NET.ping);
    try{ if(NET.host) NET.host.destroy(); }catch(e){}
    try{ if(NET.conn) NET.conn.close(); }catch(e){}
    try{ if(NET.peer) NET.peer.destroy(); }catch(e){}
    NET.role=null; NET.host=null; NET.peer=null; NET.conn=null; NET.code=null; NET.seat=0;
    this.view=null; this.lastMsgId=-1; this.lastHandNo=-1; this.lastTableKey=new Set(); this.bubbles={};
    this.show('menu');
  },

  /* ---- lobby ---- */
  renderLobby(d){
    $('#lobby-code').textContent = d.code || NET.code || '-----';
    const isHost = NET.role==='host';
    const ul = $('#lobby-seats'); ul.innerHTML='';
    d.seats.forEach((s,i)=>{
      const li=document.createElement('li');
      if(!s){ li.className='empty'; li.innerHTML='<span class="av-s">?</span><span>Aguardando jogador…</span>'; }
      else{
        li.innerHTML=`<span class="av-s">${s.avatar}</span><span>${this.esc(s.name)}</span><span class="tag">${i===0?'anfitrião':s.bot?'computador':i===d.you?'você':''}</span>`;
        if(isHost && i>0){ const k=document.createElement('button'); k.className='kick'; k.textContent='Remover'; k.onclick=()=>NET.host.kick(i); li.appendChild(k); }
      }
      ul.appendChild(li);
    });
    const humans = d.seats.filter(s=>s&&!s.bot).length;
    const empty = d.seats.filter(s=>!s).length;
    $('#lobby-hint').textContent = isHost
      ? `Sala para ${d.size} jogadores. Passe o código ou o link para seus amigos, que podem entrar do celular, tablet ou computador${d.size===4?' (duplas: você joga com quem senta de frente)':''}. Vagas livres viram computador ao iniciar.`
      : 'Aguardando o anfitrião iniciar a partida…';
    $('#lobby-host-actions').classList.toggle('hidden', !isHost);
    $('#btn-add-bot').disabled = empty===0;
    $('#btn-start').disabled = false;
    $('#btn-start').textContent = humans<2 && empty===0 ? 'Iniciar partida' : 'Iniciar partida';
  },
  esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },

  /* ---- recebimento de estado ---- */
  onView(v){
    const wasActive = $('#screen-game').classList.contains('active');
    this.view = v;
    if(!wasActive){ this.show('game'); this.keepAwake(); }
    if(v.handNo!==this.lastHandNo){ this.lastHandNo=v.handNo; this.lastTableKey=new Set(); }
    this.render();
    this.handleMessage(v);
    if(v.stage==='gameOver') this.showGameOver(v); else if(this._goOpen){ this.closeModal(); this._goOpen=false; }
  },
  async keepAwake(){
    try{ if('wakeLock' in navigator) this._wl = await navigator.wakeLock.request('screen'); }catch(e){}
  },
  onReaction(seat,text){
    this.bubbles[seat] = {text, until:Date.now()+2600};
    this.render();
    setTimeout(()=>this.render(), 2700);
  },

  /* ---- textos ---- */
  teamLabel(t,v){
    const my = v.teams[v.seat];
    if(v.nTeams===2) return t===my ? 'Nós' : 'Eles';
    const seat = v.teams.indexOf(t);
    return seat===v.seat ? 'Você' : v.names[seat];
  },
  nm(seat,v){ return seat===v.seat ? 'Você' : v.names[seat]; },
  handleMessage(v){
    const m = v.msg; if(!m || m.id===this.lastMsgId) return;
    this.lastMsgId = m.id;
    let t=null, big=false;
    switch(m.k){
      case 'truco': t = `${this.nm(m.seat,v)} pediu ${LABEL[m.to]}!`; big=true; break;
      case 'accept': t = `${this.nm(m.seat,v)} aceitou!`; break;
      case 'run': t = `${this.nm(m.seat,v)} correu!`; break;
      case 'eleven': t = `Mão de 11 — ${this.teamLabel(m.team,v)} decide`; break;
      case 'elevenPlay': t = `${this.teamLabel(m.team,v)} vai jogar a mão de 11 (vale 3)`; break;
      case 'iron': t = 'Mão de ferro! Vale 1, sem truco'; big=true; break;
      case 'hand':
        if(m.team===null) t = 'Mão empatada — ninguém pontua';
        else{
          const who = this.teamLabel(m.team,v);
          t = `${who} ${v.nTeams===2 && who==='Nós' ? 'ganhamos' : v.nTeams===2 ? 'ganharam' : who==='Você' ? 'ganhou' : 'ganhou'} a mão! +${m.pts}`;
        }
        big=true; break;
    }
    if(t) this.banner(t,big);
  },
  banner(t,big){
    const b=$('#banner'); const d=document.createElement('div');
    d.className='msg'+(big?' big':''); d.textContent=t; b.innerHTML=''; b.appendChild(d);
    setTimeout(()=>{ if(d.parentNode===b) b.removeChild(d); }, 2700);
  },

  /* ---- desenho da mesa ---- */
  cardHTML(c,cls=''){
    const red = c.s===0||c.s===2;
    return `<div class="card ${red?'red':'blk'} ${cls}"><span class="rk">${RANKS[c.r]}</span><span class="st">${SUITS[c.s]}</span></div>`;
  },
  posName(p,n){ return (n===2?['bottom','top']:n===3?['bottom','left','right']:['bottom','left','top','right'])[p]; },
  render(){
    const v=this.view; if(!v) return;
    const me=v.seat, n=v.n, now=Date.now();
    const posOf = s=>this.posName((s-me+n)%n,n);
    const active = v.stage==='turn' ? v.turn : v.stage==='truco' ? v.respSeat : v.stage==='eleven' ? v.elevenSeat : -1;

    /* placar */
    const myTeam=v.teams[me];
    const order=[myTeam,...[...Array(v.nTeams).keys()].filter(t=>t!==myTeam)];
    const wins=t=>v.rw.filter(x=>x===t).length;
    let sc='';
    order.forEach(t=>{
      let dots=''; for(let i=0;i<3;i++) dots+=`<span class="dot ${i<wins(t)?'on':''}"></span>`;
      sc+=`<div class="sc-row"><span class="lb">${this.esc(t===myTeam?'nós':v.nTeams===2?'eles':this.teamLabel(t,v).toLowerCase())}</span>${dots}<span class="pt">${v.scores[t]}</span></div>`;
    });
    sc+=`<div class="sc-val" title="Valor da mão">${v.value}</div>`;
    this.setHTML($('#score'),sc);

    /* manilhas e vira */
    let mn=''; for(let s=0;s<4;s++) mn+=`<div class="mn ${s===0||s===2?'red':'blk'}"><b>${RANKS[v.manilha]}</b><i>${SUITS[s]}</i></div>`;
    this.setHTML($('#manilhas'),`<div class="t">MANILHAS</div><div class="row">${mn}</div>`);
    this.setHTML($('#viraBox'),`<div class="back"></div>${this.cardHTML(v.vira)}`);

    /* jogadores */
    let pods='';
    for(let s=0;s<n;s++){
      const pos=posOf(s);
      const b=this.bubbles[s]&&this.bubbles[s].until>now?this.bubbles[s].text:null;
      const isEmoji=b&&[...b].length<=2;
      const badge=isEmoji?b:'😐';
      const bub=b&&!isEmoji?`<div class="bubble">${this.esc(b)}</div>`:'';
      const dealer = s===v.dealer ? '<span class="dealer-chip" title="Quem deu as cartas">D</span>' : '';
      const av=`<div class="av ${s===me?'me':''} ${s===active?'act':''}">${v.avatars[s]}<span class="bd">${badge}</span>${dealer}</div>`;
      const nm=`<div class="nm">${this.esc(s===me?v.names[s]+' (você)':v.names[s])}</div>`;
      let backs='';
      if(s!==me && v.counts[s]>0){ backs='<div class="backs">'+'<div class="back"></div>'.repeat(v.counts[s])+'</div>'; }
      if(pos==='bottom') pods+=`<div class="pod p-bottom"><div class="info">${bub}${av}${nm}</div></div>`;
      else if(pos==='top') pods+=`<div class="pod p-top"><div class="info">${bub}${av}${nm}</div>${backs}</div>`;
      else pods+=`<div class="pod p-${pos}">${backs}<div class="info">${bub}${av}${nm}</div></div>`;
    }
    this.setHTML($('#pods'),pods);

    /* centro */
    let ctr='', ctrKey='';
    const keys=[];
    const best = v.stage==='between'||v.stage==='handOver'||v.stage==='gameOver' ? v.lastWinSeat : -1;
    v.table.forEach((t,i)=>{
      const key=v.handNo+'-'+t.seat+'-'+t.card.r+t.card.s;
      const fresh=!this.lastTableKey.has(key); keys.push(key);
      const rot=((t.seat*37+t.card.r*11+t.card.s*5)%17)-8;
      const mk=f=>`<div class="pc ${posOf(t.seat)} ${f?'fly':''} ${t.seat===best?'win':''}" style="z-index:${i+1};transform:rotate(${rot}deg)">${this.cardHTML(t.card)}</div>`;
      ctr+=mk(fresh); ctrKey+=mk(false);
    });
    const ce=$('#center');
    if(ce._k!==ctrKey){ ce._k=ctrKey; ce.innerHTML=ctr; keys.forEach(k=>this.lastTableKey.add(k)); }

    /* minha mão */
    const myTurn = v.stage==='turn' && v.turn===me;
    const hand=$('#hand'); const hcls = myTurn?'mine':''; if(hand.className!==hcls) hand.className = hcls;
    this.setHTML(hand, v.hand.map((c,i)=>this.cardHTML(c, myTurn?'':'dim').replace('<div class="card','<div data-i="'+i+'" class="card')).join(''));
    this.setHTML($('#partnerHand'), v.partner ? v.partner.map(p=>`<div style="position:relative"><span class="lbl">Cartas de ${this.esc(v.names[p.seat])}</span><div style="display:flex;gap:4px">${p.cards.map(c=>this.cardHTML(c)).join('')}</div></div>`).join('') : '');

    /* botão de truco */
    const bt=$('#btnTruco');
    if(v.canTruco){ const to=NEXT[v.value]; this.setHTML(bt,`${LABEL[to]}!<small>vale ${to}</small>`); bt.classList.remove('hidden'); }
    else bt.classList.add('hidden');

    /* prompts */
    this.renderPrompt(v);
  },
  renderPrompt(v){
    const p=$('#prompt'); const me=v.seat;
    p.className='hidden';
    if(v.stage==='truco'){
      const caller=this.nm(v.pending.from,v), to=v.pending.to;
      if(v.respSeat===me){
        p.className='';
        this.setHTML(p,`<div class="q">${this.esc(caller)} pediu ${LABEL[to]}!</div><div class="s">A mão passa a valer ${to} pontos.</div>
          <div class="acts"><button class="btn btn-green" data-a="accept">Aceitar</button>
          ${to<12?`<button class="btn btn-orange" data-a="raise">${LABEL[NEXT[to]]}!</button>`:''}
          <button class="btn btn-red" data-a="run">Correr</button></div>`);
      } else {
        p.className='wait';
        this.setHTML(p,`${this.esc(caller)} pediu ${LABEL[to]} — aguardando ${this.esc(this.nm(v.respSeat,v))}…`);
      }
    } else if(v.stage==='eleven'){
      if(v.elevenSeat===me){
        p.className='';
        this.setHTML(p,`<div class="q">Mão de 11</div><div class="s">Jogar vale 3 pontos e não tem truco. Correr dá 1 ponto para eles.${v.partner?' Veja as cartas do seu parceiro acima.':''}</div>
          <div class="acts"><button class="btn btn-green" data-a="accept">Jogar</button><button class="btn btn-red" data-a="run">Correr</button></div>`);
      } else {
        p.className='wait'; this.setHTML(p,`Mão de 11 — aguardando ${this.esc(this.nm(v.elevenSeat,v))} decidir…`);
      }
    }
    // (os botões do prompt são tratados por delegação de eventos, em "7. EVENTOS")
  },

  /* ---- fim de jogo ---- */
  showGameOver(v){
    if(this._goOpen) return;
    const won = v.teams[v.seat]===v.gameWinner;
    const who = v.nTeams===2 ? (won?'Nós ganhamos!':'Eles ganharam!') : (won?'Você ganhou!':this.teamLabel(v.gameWinner,v)+' ganhou!');
    const sc = v.scores.map((s,t)=>`${this.teamLabel(t,v)}: ${s}`).join(' · ');
    const isHost = NET.role!=='client';
    this._goOpen=true;
    this.modal(`<h3>Fim de jogo</h3><div class="big-result">${won?'🏆 ':''}${this.esc(who)}</div><p style="text-align:center">${this.esc(sc)}</p>
      <div class="row">${isHost?'<button class="btn btn-orange" id="go-again">Jogar de novo</button>':'<p>Aguardando o anfitrião iniciar outra partida…</p>'}
      <button class="btn btn-ghost" id="go-exit">Sair</button></div>`);
    const a=$('#go-again'); if(a) a.onclick=()=>{ this.closeModal(); this._goOpen=false; this.lastMsgId=-1; NET.host.newEngine(); };
    $('#go-exit').onclick=()=>{ this._goOpen=false; this.leave(); };
  },

  /* ---- painéis laterais ---- */
  closePanel(){ const s=$('#sidepanel'); if(s){ s.classList.add('hidden'); s.innerHTML=''; } this.panel=null; },
  openPanel(kind){
    if(this.panel===kind) return this.closePanel();
    const s=$('#sidepanel'); this.panel=kind;
    const list = kind==='emo' ? ['😂','😎','😡','😭','👏','🤔','😏','🙏'] : ['Truco!','Vamos nessa!','Boa jogada!','Calma aí…','Tá com medo?','Bora!','Segura essa!'];
    s.innerHTML = list.map(t=>`<button class="${kind==='emo'?'emo':''}" data-t="${t}">${t}</button>`).join('');
    s.classList.remove('hidden');
    s.querySelectorAll('button').forEach(b=>b.onclick=()=>{ sendReaction(b.dataset.t); this.closePanel(); });
  }
};

/* ---------------------------------------------------------------------
   7. EVENTOS
   --------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', ()=>{
  const name0 = UI.savedName();
  $('#local-name').value = name0; $('#online-name').value = name0;

  $$('[data-go]').forEach(b=>b.onclick=()=>{
    const to=b.dataset.go;
    UI.status('online-status','');
    UI.show(to);
  });
  $$('.seg').forEach(seg=>seg.querySelectorAll('button').forEach(b=>b.onclick=()=>{
    seg.querySelectorAll('button').forEach(x=>x.classList.remove('on')); b.classList.add('on');
  }));
  const segVal = id=>+($(`#${id} .on`)||{dataset:{v:4}}).dataset.v;
  const getName = id=>{ const n=($('#'+id).value||'').trim()||'Jogador'; UI.saveName(n); return n; };

  /* regras */
  $('#btn-rules').onclick=()=>{
    UI.modal(`<h3>Como jogar</h3>
      <ul>
        <li>Cada jogador recebe 3 cartas. A carta virada (vira) define a <b>manilha</b>: a carta seguinte na ordem.</li>
        <li>Ordem das cartas, da mais fraca à mais forte: 4, 5, 6, 7, Q, J, K, A, 2, 3. Acima de todas ficam as manilhas (♦ &lt; ♠ &lt; ♥ &lt; ♣).</li>
        <li>Vence a mão quem ganhar 2 das 3 rodadas. Se uma rodada empata, quem ganhou a outra leva a mão.</li>
        <li>A mão vale 1 ponto. Em qualquer momento da sua vez você pode pedir <b>Truco</b> (3), depois Seis, Nove e Doze. Quem recebe o pedido pode aceitar, correr ou aumentar.</li>
        <li><b>Mão de 11:</b> a equipe com 11 pontos escolhe jogar (vale 3) ou correr. Se as duas equipes têm 11, é mão de ferro (vale 1, sem truco).</li>
        <li>Vence a partida quem chegar a 12 pontos. Com 4 jogadores, jogam em duplas (quem senta de frente é seu parceiro). Com 3, cada um joga por si.</li>
      </ul><div class="row"><button class="btn btn-orange" id="m-ok">Entendi</button></div>`);
    $('#m-ok').onclick=()=>UI.closeModal();
  };

  /* local */
  $('#btn-local-start').onclick=()=>{
    const name=getName('local-name'), size=segVal('local-size');
    NET.role='local'; NET.code=null;
    NET.host=new Host('local',size);
    NET.host.addHuman(0,name,UI.myAvatar(),null);
    NET.host.start();
  };

  /* online */
  $('#btn-create').onclick=()=>createRoom(getName('online-name'), segVal('online-size'));
  $('#btn-join').onclick=()=>joinRoom($('#join-code').value, getName('online-name'));
  $('#join-code').addEventListener('input',e=>{ e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''); });
  const q=new URLSearchParams(location.search).get('sala');
  if(q){ $('#join-code').value=q.toUpperCase().slice(0,5); UI.show('online'); }

  /* lobby */
  $('#btn-lobby-exit').onclick=()=>UI.leave();
  $('#btn-add-bot').onclick=()=>{ if(NET.host&&NET.host.addBot()) NET.host.sendLobby(); };
  $('#btn-start').onclick=()=>{ if(NET.host) NET.host.start(); };
  const copy=async(text,msg)=>{ try{ await navigator.clipboard.writeText(text); UI.toast(msg); }catch(e){ UI.toast(text); } };
  $('#btn-copy-code').onclick=()=>copy(NET.code||'','Código copiado!');
  $('#btn-copy-link').onclick=()=>{
    if(location.protocol==='file:') return UI.toast('Para compartilhar o link, publique o site (GitHub Pages, etc.). Use o código.');
    const url=location.origin+location.pathname+'?sala='+NET.code;
    if(navigator.share){ navigator.share({title:'Truco',text:'Entre na minha sala de Truco!',url}).catch(()=>{}); }
    else copy(url,'Link copiado!');
  };

  /* mesa */
  // Ações da mesa disparam no instante do toque (pointerdown) e usam delegação de eventos.
  // Assim o jogo não perde o clique se a mesa for atualizada entre apertar e soltar o dedo.
  const press=(el,fn)=>{
    if(window.PointerEvent) el.addEventListener('pointerdown',e=>{ if(e.pointerType==='mouse' && e.button!==0) return; fn(e); });
    else el.addEventListener('click',fn);
  };
  press($('#hand'),e=>{
    const c=e.target.closest('.card'); const v=UI.view;
    if(!c||!v||v.stage!=='turn'||v.turn!==v.seat) return;
    sendAct({type:'play', i:+c.dataset.i});
  });
  press($('#btnTruco'),()=>sendAct({type:'truco'}));
  press($('#prompt'),e=>{
    const b=e.target.closest('[data-a]'); if(b) sendAct({type:b.dataset.a});
  });

  /* ao voltar para a aba (celular desbloqueado, troca de app): ressincroniza e retoma a partida */
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden) return;
    if(NET.role==='client'){ try{ if(NET.conn&&NET.conn.open) NET.conn.send({t:'sync'}); }catch(e){} }
    else if(NET.host && NET.host.engine){ NET.host.broadcast(); NET.host.schedule(); }
    if(UI.view) UI.keepAwake();
  });
  $('#btn-emoji').onclick=()=>UI.openPanel('emo');
  $('#btn-chat').onclick=()=>UI.openPanel('chat');
  $('#btn-menu').onclick=()=>{
    UI.modal(`<h3>Menu</h3><div class="row"><button class="btn btn-green" id="m-cont">Continuar</button></div>
      <div class="row"><button class="btn btn-ghost" id="m-rules">Como jogar</button><button class="btn btn-red" id="m-exit">Sair da partida</button></div>`);
    $('#m-cont').onclick=()=>UI.closeModal();
    $('#m-rules').onclick=()=>{ UI.closeModal(); $('#btn-rules').click(); };
    $('#m-exit').onclick=()=>{ UI.closeModal(); UI.leave(); };
  };
  $('#modal').addEventListener('click',e=>{ if(e.target.id==='modal' && !UI._goOpen) UI.closeModal(); });
});
