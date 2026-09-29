let sb = null;
let supabaseInitError = null;
try {
  if (!window.supabase?.createClient) throw new Error("Supabase-biblioteket blev ikke indlæst");
  if (!window.SUPABASE_CONFIG?.url || !window.SUPABASE_CONFIG?.anonKey) throw new Error("Supabase-konfiguration mangler");
  sb = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
} catch (err) { console.error(err); supabaseInitError = err; }

const DATA = window.APP_DATA;
const CFG = window.APP_CONFIG;
const teamMap = Object.fromEntries(DATA.teams.map(t => [t.id, t]));
const playerMap = Object.fromEntries(DATA.teams.flatMap(t => t.players.map(p => [p.id, {...p, originalTeamId:t.id}])));
let rosterState = {}; // matchId -> {teamId, slots:[], absences:[]}
let schedule = [];
let rounds = [];
let currentRound = null;
let statsMode = 'teams';
let scheduleMode = 'all';
let usingLocalFallback = false;
let scheduleUsingCache = false;

const $ = sel => document.querySelector(sel);
function rosterKey(matchId){return matchId}
function getCurrentDateLocal(){const now=new Date();return new Date(now.getFullYear(),now.getMonth(),now.getDate())}
function parseIsoDate(s){const [y,m,d]=String(s).split('-').map(Number);return new Date(y,m-1,d)}
function dateToText(dateISO){const [y,m,d]=dateISO.split('-');return `${d}-${m}-${y}`}
function formatLongDate(dateISO){return parseIsoDate(dateISO).toLocaleDateString('da-DK',{weekday:'long',day:'numeric',month:'long'})}
function formatShortDate(dateISO){return parseIsoDate(dateISO).toLocaleDateString('da-DK',{day:'2-digit',month:'2-digit'})}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function setStatus(text,offline=false){$('#saveStatus').innerHTML=`<span class="status-dot ${offline?'offline':''}"></span>${escapeHtml(text)}`}
function withTimeout(promise,ms=9000){return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Forbindelsen til Supabase tog for lang tid')),ms))])}

function baseRoster(teamId){
  const team=teamMap[teamId];
  return [...team.players.map(p=>({playerId:p.id,name:p.name,originalTeamId:teamId,kind:'fast'})),...Array.from({length:Math.max(0,CFG.maxPlayers-team.players.length)},()=>null)];
}
function normalizeStored(value,teamId){
  let slots=Array.isArray(value)?value:(value&&Array.isArray(value.slots)?value.slots:[]);
  let absences=Array.isArray(value?.absences)?value.absences:[];
  slots=slots.slice(0,CFG.maxPlayers).map(x=>x&&x.playerId?x:null);
  while(slots.length<CFG.maxPlayers) slots.push(null);
  const currentIds=new Set(slots.filter(Boolean).map(x=>x.playerId));
  const seen=new Set();
  absences=absences.filter(x=>x&&x.playerId&&!currentIds.has(x.playerId)&&!seen.has(x.playerId)&&playerMap[x.playerId]);
  absences.forEach(x=>seen.add(x.playerId));
  return {teamId,slots,absences};
}
function ensureMatchState(match){
  const key=rosterKey(match.id);
  if(!rosterState[key]) rosterState[key]={teamId:match.teamId,slots:baseRoster(match.teamId),absences:[]};
  return rosterState[key];
}
function getState(matchId){
  if(!rosterState[matchId]){const m=schedule.find(x=>x.id===matchId);if(m) rosterState[matchId]={teamId:m.teamId,slots:baseRoster(m.teamId),absences:[]};}
  return rosterState[matchId];
}
function getRoster(matchId){return getState(matchId)?.slots||[]}
function getAbsences(matchId){return getState(matchId)?.absences||[]}
function setAbsence(matchId,player){const a=getAbsences(matchId);if(!a.some(x=>x.playerId===player.playerId))a.push({...player,reason:''})}
function setAbsenceReason(matchId,playerId,reason){const x=getAbsences(matchId).find(v=>v.playerId===playerId);if(x)x.reason=reason}
function removeAbsence(matchId,playerId){const s=getState(matchId);if(s)s.absences=s.absences.filter(x=>x.playerId!==playerId)}

function serializeState(){
  const matches={};
  for(const [id,val] of Object.entries(rosterState)) matches[id]={teamId:val.teamId,slots:val.slots,absences:val.absences||[]};
  return {matches,updatedAt:new Date().toISOString()};
}
function applyStoredState(state){
  rosterState={};
  const matches=state&&typeof state==='object'&&state.matches&&typeof state.matches==='object'?state.matches:{};
  for(const [id,val] of Object.entries(matches)) rosterState[id]=normalizeStored(val,val?.teamId);
  schedule.forEach(ensureMatchState);
}

async function loadState(){
  setStatus('Henter fælles holddata…');
  if(supabaseInitError||!sb) throw supabaseInitError||new Error('Supabase er ikke initialiseret');
  const {data,error}=await withTimeout(sb.from(CFG.stateTable).select('id,state,updated_at').eq('id',CFG.stateRowId).maybeSingle());
  if(error) throw error;
  if(!data) throw new Error(`Fandt ikke rækken ${CFG.stateRowId} i ${CFG.stateTable}`);
  applyStoredState(data.state||{});
  usingLocalFallback=false;
  setStatus(scheduleUsingCache?'Fælles data gemmes automatisk · kalender fra cache':'Fælles data gemmes automatisk');
}
async function saveAll(){
  if(usingLocalFallback){localStorage.setItem('u9-rosters',JSON.stringify(rosterState));setStatus('Gemt lokalt',true);return}
  setStatus('Gemmer…');
  const {error}=await withTimeout(sb.from(CFG.stateTable).update({state:serializeState(),updated_at:new Date().toISOString()}).eq('id',CFG.stateRowId));
  if(error){console.error(error);usingLocalFallback=true;localStorage.setItem('u9-rosters',JSON.stringify(rosterState));setStatus('Gemmet lokalt · Supabase fejlede',true);toast('Ændringen blev gemt lokalt. Tjek Supabase.');}
  else setStatus(scheduleUsingCache?'Gemt · alle kan se ændringen · kalender fra cache':'Gemt · alle kan se ændringen');
}

function loadLocalState(){
  try{const saved=JSON.parse(localStorage.getItem('u9-rosters')||'{}');rosterState={};for(const [id,val] of Object.entries(saved))rosterState[id]=normalizeStored(val,val?.teamId)}catch{}
  schedule.forEach(ensureMatchState);
}

async function refreshSchedule(){
  try{
    const response=await fetch(window.SUPABASE_CONFIG.icalFunctionUrl,{cache:'no-store'});
    if(!response.ok) throw new Error(`Kalendersynkronisering fejlede (${response.status})`);
    const data=await response.json();
    if(!data.matches?.length) throw new Error(data.errors?.length?data.errors.join(' · '):'Ingen kampe fundet i kalenderne');
    schedule=data.matches.map(m=>({...m,date:dateToText(m.dateISO)})).sort((a,b)=>a.sortTs-b.sortTs||a.teamId.localeCompare(b.teamId));
    scheduleUsingCache=false;
    localStorage.setItem(CFG.scheduleCacheKey,JSON.stringify({fetchedAt:data.fetchedAt,matches:schedule}));
    buildRounds();
    schedule.forEach(ensureMatchState);
    renderAll();
    setStatus('Fælles data gemmes automatisk');
    return true;
  }catch(err){
    console.warn('iCal sync failed',err);
    try{
      const cached=JSON.parse(localStorage.getItem(CFG.scheduleCacheKey)||'null');
      if(cached?.matches?.length){schedule=cached.matches; scheduleUsingCache=true; buildRounds(); schedule.forEach(ensureMatchState); setStatus('Fælles data gemmes automatisk · kalender fra cache',true);renderAll();return true;}
    }catch{}
    return false;
  }
}

function buildRounds(){
  const groups=new Map();
  const sorted=[...schedule].sort((a,b)=>a.sortTs-b.sortTs);
  for(const m of sorted){
    const key=m.explicitRound!=null?`r-${m.explicitRound}`:`w-${m.weekKey}`;
    if(!groups.has(key)) groups.set(key,{key,explicitRound:m.explicitRound??null,matches:[]});
    groups.get(key).matches.push(m);
  }

  let arr=[...groups.values()].sort((a,b)=>a.matches[0].sortTs-b.matches[0].sortTs);

  // A single stray match should belong to the preceding round rather than
  // creating its own one-match round. This also handles the situation where
  // DanskHåndbold's calendar introduces one extra match between two rounds.
  for(let i=1;i<arr.length;){
    if(arr[i].matches.length===1){
      arr[i-1].matches.push(...arr[i].matches);
      arr[i-1].matches.sort((a,b)=>a.sortTs-b.sortTs);
      arr.splice(i,1);
    }else{
      i++;
    }
  }

  rounds=arr.map((g,i)=>({...g,round:i+1}));
  // Write derived round number onto each match for display/statistics.
  rounds.forEach(r=>r.matches.forEach(m=>m.round=r.round));
}

function getRoundDisplayMatches(r){
  // In the round overview, show only the first match for the same team on the
  // same day. Hold 5 can have several tournament matches on one day, while
  // the detailed Kampprogram still shows every match.
  const seen=new Set();
  return [...r.matches]
    .sort((a,b)=>a.sortTs-b.sortTs || a.teamId.localeCompare(b.teamId))
    .filter(m=>{
      const key=`${m.teamId}|${m.dateISO}`;
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
function getInitialRound(){
  if(!rounds.length)return null;
  const today=getCurrentDateLocal();
  const r=rounds.find(r=>r.matches.some(m=>parseIsoDate(m.dateISO).getTime()>=today.getTime()));
  return r?r.round:rounds[rounds.length-1].round;
}
function currentRoundObj(){return rounds.find(r=>r.round===currentRound)}
function roundDateText(r){return [...new Set(r.matches.map(m=>m.date))].join(' · ')}

function renderTabs(){
  const el=$('#roundTabs');
  el.innerHTML=`<button class="tab ${currentRound==='schedule'?'active':''}" data-schedule="1">Kampprogram</button>${rounds.map(r=>`<button class="tab ${currentRound===r.round?'active':''}" data-round="${r.round}">Runde ${r.round}</button>`).join('')}<button class="tab stats ${currentRound==='stats'?'active':''}" data-stats="1">Spillerstatistik</button>`;
  el.querySelector('[data-schedule]').onclick=()=>{currentRound='schedule';scheduleMode='all';renderAll()};
  el.querySelectorAll('[data-round]').forEach(b=>b.onclick=()=>{currentRound=Number(b.dataset.round);renderAll()});
  el.querySelector('[data-stats]').onclick=()=>{currentRound='stats';statsMode='teams';renderAll()};
}

function renderRound(){
  $('#statsView').classList.add('hidden');$('#scheduleView').classList.add('hidden');$('#roundView').classList.remove('hidden');
  const r=currentRoundObj();
  if(!r){$('#roundView').innerHTML='<div class="notice error">Der er endnu ikke hentet et kampprogram. Synkroniseringen med DanskHåndbold skal sættes op i Supabase.</div>';return}
  const displayMatches=getRoundDisplayMatches(r);
  $('#roundView').innerHTML=`<div class="round-head"><div><h2>Runde ${r.round}</h2><p>${roundDateText(r)} · ${displayMatches.length} Hjallerup-hold i kamp</p></div></div><div class="round-grid">${displayMatches.map(renderTeamCard).join('')}</div>`;
  attachTeamActions();
}
function renderTeamCard(m){
  const roster=getRoster(m.id),absences=getAbsences(m.id),filled=roster.filter(Boolean).length,team=teamMap[m.teamId];
  const playersHtml=roster.map((p,i)=>{
    if(!p)return `<div class="player-row"><div class="player-number">${i+1}</div><div class="player-name empty">Ledig plads</div><div class="player-actions"><button class="add-btn" data-add="${m.id}" data-slot="${i}">+ Tilføj</button></div></div>`;
    const isLoan=p.originalTeamId!==m.teamId;
    return `<div class="player-row"><div class="player-number">${i+1}</div><div class="player-name ${isLoan?'loaned-player':''}">${escapeHtml(p.name)}</div>${isLoan?'<span class="loan-tag">LÅN</span>':''}<div class="player-actions"><button class="icon-btn remove" title="Fjern spiller" data-remove="${m.id}" data-slot="${i}">×</button></div></div>`;
  }).join('');
  const absencesHtml=absences.length?absences.map(p=>`<div class="absence-row"><div class="absence-main"><span class="absence-dot">!</span><strong>${escapeHtml(p.name)}</strong>${p.originalTeamId!==m.teamId?'<span class="absence-note">lånt spiller</span>':''}<button class="absence-remove" type="button" title="Fjern fra afbudslisten" data-absence-remove="${m.id}" data-player-id="${p.playerId}">×</button></div><input class="absence-reason" maxlength="120" value="${escapeHtml(p.reason||'')}" placeholder="Årsag til afbud…" data-absence-reason="${m.id}" data-player-id="${p.playerId}"></div>`).join(''):'<div class="no-absence">Ingen registrerede afbud</div>';
  const level=team.level?`<span class="team-level">${escapeHtml(team.level)}</span>`:'';
  return `<article class="team-card"><div class="team-head"><div class="team-title"><div><h3>${escapeHtml(team.name)} ${level}</h3></div><span class="badge">${filled}/${CFG.maxPlayers} spillere</span></div><div class="match"><strong>${escapeHtml(m.day)} ${escapeHtml(m.date)} kl. ${escapeHtml(m.time)}</strong><br>${escapeHtml(m.homeAway)} · ${escapeHtml(m.opponent)}<br><span class="venue">${escapeHtml(m.venue)}</span></div></div><div class="roster">${playersHtml}</div><div class="team-footer"><span>${filled<CFG.maxPlayers?`${CFG.maxPlayers-filled} ledige pladser`:'Holdet er fyldt'}</span>${filled<CFG.maxPlayers?`<button class="add-btn" data-add="${m.id}" data-slot="${roster.findIndex(x=>!x)}">+ Lån spiller</button>`:'<span class="full">✓ Klar</span>'}</div><div class="absence-box"><div class="absence-head"><span>Afbud</span><span class="absence-count">${absences.length}</span></div><div class="absence-list">${absencesHtml}</div></div></article>`;
}
function attachTeamActions(){
  document.querySelectorAll('[data-remove]').forEach(btn=>btn.onclick=async()=>{
    const id=btn.dataset.remove,slot=Number(btn.dataset.slot),roster=getRoster(id),player=roster[slot];if(!player)return;roster[slot]=null;setAbsence(id,player);renderRound();renderTabs();await saveAll();toast(`${player.name} er registreret som afbud`);
  });
  document.querySelectorAll('[data-add]').forEach(btn=>btn.onclick=()=>openPlayerModal(btn.dataset.add,Number(btn.dataset.slot)));
  document.querySelectorAll('[data-absence-reason]').forEach(input=>input.onchange=async()=>{setAbsenceReason(input.dataset.absenceReason,input.dataset.playerId,input.value.trim());await saveAll()});
  document.querySelectorAll('[data-absence-remove]').forEach(btn=>btn.onclick=async()=>{const id=btn.dataset.absenceRemove,pid=btn.dataset.playerId,a=getAbsences(id).find(x=>x.playerId===pid);if(!a)return;removeAbsence(id,pid);renderRound();await saveAll();toast(`${a.name} er fjernet fra afbudslisten`)});
}
function availablePlayers(matchId){
  const target=getRoster(matchId);const currentIds=new Set(target.filter(Boolean).map(p=>p.playerId));
  const usedElsewhere=new Map();
  const m=schedule.find(x=>x.id===matchId);if(!m)return [];
  const sameRound=rounds.find(r=>r.round===m.round);
  for(const other of (sameRound?.matches||[])){
    if(other.id===matchId)continue;
    for(const p of getRoster(other.id).filter(Boolean)){if(!usedElsewhere.has(p.playerId))usedElsewhere.set(p.playerId,[]);usedElsewhere.get(p.playerId).push(other.teamId)}
  }
  return Object.values(playerMap).filter(p=>!currentIds.has(p.id)).sort((a,b)=>a.name.localeCompare(b.name,'da')).map(p=>({...p,usedOn:usedElsewhere.get(p.id)||[]}));
}
function openPlayerModal(matchId,slot){
  const m=schedule.find(x=>x.id===matchId);const options=availablePlayers(matchId);const modal=document.createElement('div');modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal"><h3>Tilføj spiller til ${escapeHtml(teamMap[m.teamId].name)}</h3><p>En spiller må gerne spille på flere hold i samme runde.</p><select id="loanSelect"><option value="">Vælg spiller…</option>${options.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} · ${escapeHtml(teamMap[p.originalTeamId].name)}${p.usedOn.length?` · også på ${p.usedOn.map(id=>escapeHtml(teamMap[id].name)).join(', ')}`:''}</option>`).join('')}</select><div class="modal-actions"><button class="btn cancel">Annuller</button><button class="btn save">Tilføj</button></div></div>`;
  document.body.appendChild(modal);modal.querySelector('.cancel').onclick=()=>modal.remove();modal.addEventListener('click',e=>{if(e.target===modal)modal.remove()});
  modal.querySelector('.save').onclick=async()=>{const id=modal.querySelector('#loanSelect').value;if(!id)return;const p=playerMap[id],roster=getRoster(matchId),target=slot>=0&&!roster[slot]?slot:roster.findIndex(x=>!x);if(target<0){toast(`Holdet har allerede ${CFG.maxPlayers} spillere`);return}roster[target]={playerId:p.id,name:p.name,originalTeamId:p.originalTeamId,kind:p.originalTeamId===m.teamId?'fast':'loan'};removeAbsence(matchId,p.id);modal.remove();renderRound();await saveAll();toast(`${p.name} er tilføjet til ${teamMap[m.teamId].name}`)};
}

function renderScheduleTable(matches){
  const groups=[];for(const m of [...matches].sort((a,b)=>a.sortTs-b.sortTs)){let g=groups.find(x=>x.dateISO===m.dateISO);if(!g){g={dateISO:m.dateISO,matches:[]};groups.push(g)}g.matches.push(m)}
  return `<div class="schedule-groups">${groups.map(g=>`<section class="schedule-day"><div class="schedule-day-head"><div><h3>${escapeHtml(formatLongDate(g.dateISO))}</h3><span>${g.matches.length} kamp${g.matches.length===1?'':'e'}</span></div><strong>${escapeHtml(dateToText(g.dateISO))}</strong></div><div class="schedule-table-wrap"><table class="schedule-table"><thead><tr><th>Kl.</th><th>Hold</th><th>H/U</th><th>Modstander</th><th>Spillested</th><th>Runde</th></tr></thead><tbody>${g.matches.map(m=>`<tr><td class="schedule-time">${escapeHtml(m.time)}</td><td><strong>${escapeHtml(teamMap[m.teamId].name)}</strong></td><td><span class="home-away ${m.homeAway==='Hjemme'?'home':'away'}">${m.homeAway==='Hjemme'?'H':'U'}</span></td><td>${escapeHtml(m.opponent)}</td><td class="schedule-venue">${escapeHtml(m.venue)}</td><td><span class="round-pill">R${m.round}</span></td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>`;
}
function renderSchedule(){
  $('#roundView').classList.add('hidden');$('#statsView').classList.add('hidden');$('#scheduleView').classList.remove('hidden');
  const today=getCurrentDateLocal();
  const allUpcoming=schedule.filter(m=>parseIsoDate(m.dateISO).getTime()>=today.getTime());
  const allPlayed=schedule.filter(m=>parseIsoDate(m.dateISO).getTime()<today.getTime());
  let matches=scheduleMode==='all'?allUpcoming:scheduleMode==='played'?allPlayed:schedule.filter(m=>m.teamId===scheduleMode);
  if(scheduleMode==='played') matches=allPlayed;
  const subTabs=`<div class="schedule-switch" role="tablist" aria-label="Kampprogramvisning"><button class="schedule-switch-btn ${scheduleMode==='all'?'active':''}" data-schedule-mode="all">Samlet kampprogram</button><button class="schedule-switch-btn ${scheduleMode==='played'?'active':''}" data-schedule-mode="played">Spillede kampe</button>${DATA.teams.map(team=>`<button class="schedule-switch-btn ${scheduleMode===team.id?'active':''}" data-schedule-mode="${team.id}">${escapeHtml(team.name)}</button>`).join('')}</div>`;
  const title=scheduleMode==='played'?'Spillede kampe':scheduleMode==='all'?'Samlet kampprogram':teamMap[scheduleMode].name;
  const text=scheduleMode==='played'?'Kampe med dato før dags dato · kronologisk oversigt':scheduleMode==='all'?'Kommende kampe fra DanskHåndbolds iCal-kalendere · kronologisk oversigt':`Kun kampe for ${teamMap[scheduleMode].name} · kronologisk oversigt`;
  const count=matches.length;
  $('#scheduleView').innerHTML=`<div class="round-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p></div></div>${subTabs}<div class="schedule-summary"><span><strong>${count}</strong> ${count===1?'kamp':'kampe'}</span>${scheduleMode==='all'?`<span>${allPlayed.length} spillede kampe ligger under "Spillede kampe"</span>`:''}<span>Efterår 2026</span>${scheduleUsingCache?'<span>Kalenderdata fra lokal cache</span>':''}</div>${matches.length?renderScheduleTable(matches):`<div class="notice">${scheduleMode==='played'?'Der er endnu ingen spillede kampe.':scheduleMode==='all'?'Der er ingen kommende kampe i kalenderen.':'Der er ingen kampe registreret for dette hold endnu.'}</div>`}`;
  document.querySelectorAll('[data-schedule-mode]').forEach(btn=>btn.onclick=()=>{scheduleMode=btn.dataset.scheduleMode;renderSchedule()});
}

function buildStats(){
  return DATA.teams.map(team=>{
    const players=team.players.map(p=>{let own=0,total=0,extra=0;const extraTeams=new Map();for(const m of schedule){const entries=getRoster(m.id).filter(x=>x&&x.playerId===p.id);if(!entries.length)continue;total+=entries.length;if(m.teamId===team.id)own+=entries.length;else{extra+=entries.length;extraTeams.set(m.teamId,(extraTeams.get(m.teamId)||0)+entries.length)}}return {...p,own,total,extra,extraTeams:[...extraTeams.entries()]}});return {...team,players};
  });
}
function renderStats(){
  $('#roundView').classList.add('hidden');$('#scheduleView').classList.add('hidden');$('#statsView').classList.remove('hidden');
  const grouped=buildStats();const allPlayers=grouped.flatMap(team=>team.players.map(p=>({...p,originalTeamName:team.name})));allPlayers.sort((a,b)=>b.total-a.total||b.extra-a.extra||a.name.localeCompare(b.name,'da'));
  const modeTabs=`<div class="stats-switch" role="tablist"><button class="stats-switch-btn ${statsMode==='teams'?'active':''}" data-stats-mode="teams">Efter oprindeligt hold</button><button class="stats-switch-btn ${statsMode==='all'?'active':''}" data-stats-mode="all">Samlet liste · flest kampe</button></div>`;
  const teamView=`<div class="stats-groups">${grouped.map(team=>`<section class="stats-team"><div class="stats-team-head"><h3>${escapeHtml(team.name)} · ${escapeHtml(team.level)}</h3><span>${team.players.length} spillere</span></div><div class="stats-table-wrap"><table><thead><tr><th>Spiller</th><th>Eget hold</th><th>Ekstra</th><th>Ekstra for</th><th>Samlet</th></tr></thead><tbody>${team.players.map(p=>`<tr><td><strong>${escapeHtml(p.name)}</strong></td><td class="count">${p.own}</td><td class="count highlight">${p.extra}</td><td class="small">${p.extraTeams.length?p.extraTeams.map(([id,n])=>`${escapeHtml(teamMap[id].name)} (${n})`).join(', '):'—'}</td><td class="count total-count">${p.total}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>`;
  const allView=`<section class="stats-team stats-all"><div class="stats-team-head"><h3>Alle spillere</h3><span>Sorteret efter samlet antal kampe</span></div><div class="stats-table-wrap"><table><thead><tr><th>#</th><th>Spiller</th><th>Oprindeligt hold</th><th>Eget</th><th>Ekstra</th><th>Ekstra for</th><th>Samlet</th></tr></thead><tbody>${allPlayers.map((p,i)=>`<tr><td class="rank">${i+1}</td><td><strong>${escapeHtml(p.name)}</strong></td><td>${escapeHtml(p.originalTeamName)}</td><td class="count">${p.own}</td><td class="count highlight">${p.extra}</td><td class="small">${p.extraTeams.length?p.extraTeams.map(([id,n])=>`${escapeHtml(teamMap[id].name)} (${n})`).join(', '):'—'}</td><td class="count total-count">${p.total}</td></tr>`).join('')}</tbody></table></div></section>`;
  $('#statsView').innerHTML=`<div class="round-head"><div><h2>Spillerstatistik</h2><p>${statsMode==='teams'?'Spillerne er grupperet efter deres oprindelige hold.':'Samlet oversigt · flest samlede kampe øverst.'}</p></div></div>${modeTabs}<div class="notice">En spiller kan spille på flere hold i samme runde. Lånte spillere tæller som ekstra kampe.</div>${statsMode==='teams'?teamView:allView}`;
  document.querySelectorAll('[data-stats-mode]').forEach(btn=>btn.onclick=()=>{statsMode=btn.dataset.statsMode;renderStats()});
}

function renderAll(){renderTabs();if(currentRound==='stats')renderStats();else if(currentRound==='schedule')renderSchedule();else renderRound()}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),2200)}

async function boot(){
  setStatus('Henter kampprogram…');
  const gotSchedule=await refreshSchedule();
  if(!gotSchedule){setStatus('⚠️ Kunne ikke hente kampprogram',true);$('#roundView').innerHTML='<div class="notice error">Kunne ikke hente kampprogrammet fra DanskHåndbold endnu. Supabase Edge Function <strong>u9-ical-sync</strong> skal være oprettet og publiceret.</div>';renderTabs();return}
  currentRound=getInitialRound();renderAll();
  try{
    await loadState();
  }catch(err){
    console.error(err);usingLocalFallback=true;loadLocalState();setStatus(`⚠️ Supabase-forbindelse fejlede · ${err.message||err}`,true);toast('Fælles holddata kunne ikke hentes fra Supabase');renderAll();
  }
  setInterval(async()=>{if(!usingLocalFallback){try{await loadState();renderAll()}catch(e){console.warn('State refresh failed',e)}}},CFG.stateRefreshMs);
  setInterval(async()=>{const oldIds=new Set(schedule.map(m=>m.id));const ok=await refreshSchedule();if(ok){if(!rounds.length)currentRound=getInitialRound();else if(!oldIds.size)currentRound=getInitialRound();renderAll()}},CFG.scheduleRefreshMs);
}
boot();
