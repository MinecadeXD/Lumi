const $ = id => document.getElementById(id);
let socket;
let currentMode='manual';
let lookYaw=0,lookPitch=0;
function toast(message) { const el=$('toast'); el.textContent=message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2500); }
async function api(url,options={}) {
  const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(response.status===401){showLogin();throw new Error('Please sign in again.');}
  if(!response.ok)throw new Error(data.error||'Request failed.');
  return data;
}
function stopViewer(){ $('viewerFrame').src='about:blank'; playFocused=false; }
function showLogin(){ stopViewer();$('login').classList.remove('hidden');$('app').classList.add('hidden');if(socket)socket.disconnect(); }
function showApp(){ $('login').classList.add('hidden');$('app').classList.remove('hidden');connect();loadAll(); }
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginError').textContent='';try{await api('/api/login',{method:'POST',body:JSON.stringify({username:$('username').value,password:$('password').value})});showApp();}catch(err){$('loginError').textContent=err.message;}});
$('logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'});}catch{}showLogin();};
async function botAction(action){
  const buttons=[$('botStart'),$('botStop'),$('botRejoin')];
  buttons.forEach(button=>button.disabled=true);
  try{
    const result=await api('/api/bot/'+action,{method:'POST'});
    if(result.bot)updateStatus(result.bot);
    if(result.bot?.state==='error')toast(result.bot.error||'Minecraft connection failed.');
    else toast(action==='start'?'Starting Lumi…':action==='stop'?'Lumi stopped.':'Rejoining Minecraft…');
  }catch(err){
    toast(err.message||'Bot action failed.');
    try{const status=await api('/api/status');updateStatus(status.bot);}catch{}
  }
}
$('botStart').onclick=()=>botAction('start');
$('botStop').onclick=()=>botAction('stop');
$('botRejoin').onclick=()=>botAction('rejoin');

function connect(){
 if(socket)socket.disconnect();socket=io();
 socket.on('connect_error',()=>toast('Dashboard connection lost.'));
 socket.on('controlError',v=>toast(v.message||'Action unavailable.'));
 socket.on('status',updateStatus);socket.on('position',p=>{if(p)$('position').textContent=[p.x,p.y,p.z].join(', ');});
 socket.on('webIncoming',addMessage);
 socket.on('chat',v=>{if(v.source==='bot'||v.source==='dashboard')addMessage(v);});
 socket.on('aiState',v=>{if(v.mode)applyMode(v.mode);$('aiStatus').textContent=v.enabled?'AI enabled':'AI disabled';});
 socket.on('mode',v=>applyMode(v.mode));
 socket.on('inventory',renderInventory);
 socket.on('conversationState',v=>{$('aiStatus').textContent=v.active?'Conversation active':'Enabled';});
 socket.on('webListenState',v=>{$('listenState').textContent=v.active?'Listening for 5 minutes':'Not listening';});
 socket.on('memorySuggestion',()=>{loadSuggestions();toast('Lumi suggested a memory.');});
 socket.on('aiError',v=>toast(v.message||'AI request failed.'));
}
function updateStatus(v){const state=v.state||(v.connected?'online':'stopped');const online=state==='online';$('connection').textContent=online?'● Online':state==='connecting'?'◌ Connecting':state==='disconnecting'?'◌ Stopping':state==='error'?'● Error':'● Offline';$('connection').style.color=online?'var(--green)':state==='error'?'var(--red)':'var(--muted)';$('status').textContent=online?'Online':state==='connecting'?'Connecting':state==='disconnecting'?'Stopping':state==='error'?'Error':'Offline';$('health').textContent=Number.isFinite(v.health)?v.health+' ♥':'—';$('food').textContent=Number.isFinite(v.food)?v.food+'/20':'—';$('position').textContent=v.position?[v.position.x,v.position.y,v.position.z].join(', '):'—';if(Number.isFinite(v.yaw))lookYaw=v.yaw;if(Number.isFinite(v.pitch))lookPitch=v.pitch;const labels={stopped:'Stopped — start Lumi when ready.',connecting:'Connecting to the Minecraft server…',online:'Connected. Lumi is online.',disconnecting:'Disconnecting from Minecraft…',error:v.error||'Connection failed. You can try rejoining.'};if($('botStateText'))$('botStateText').textContent=labels[state]||state;$('botStart').disabled=state==='online'||state==='connecting'||state==='disconnecting';$('botStop').disabled=state==='stopped'||state==='disconnecting';$('botRejoin').disabled=state==='connecting'||state==='disconnecting';}
function addMessage(v){const box=$('messages');const el=document.createElement('div');el.className='message'+(v.source==='bot'||v.source==='dashboard'?' bot':'');const name=document.createElement('b');name.textContent=v.username||'Server';const text=document.createElement('span');text.textContent=v.message||'';el.append(name,text);box.append(el);box.scrollTop=box.scrollHeight;}
$('chatForm').onsubmit=e=>{e.preventDefault();const message=$('chatInput').value.trim();if(message&&socket){socket.emit('webChat',{message});$('chatInput').value='';}};
function applyMode(mode){currentMode=mode==='automatic'?'automatic':'manual';const auto=currentMode==='automatic';$('manualMode')?.classList.toggle('selected',!auto);$('automaticMode')?.classList.toggle('selected',auto);$('modeDescription').textContent=auto?'Automatic: AI chat and only addressed Lumi commands. No autonomous movement.':'Manual: website gameplay controls enabled; AI command execution disabled.';$('aiStatus').textContent=auto?'AI enabled':'AI disabled';$('playMode').textContent=auto?'Automatic':'Manual';document.querySelectorAll('[data-control],[data-jump],#stop,#hotbar button,#inventoryButton,#dropButton').forEach(el=>el.disabled=auto);}
async function setMode(mode){try{const result=await api('/api/mode',{method:'POST',body:JSON.stringify({mode})});applyMode(result.mode);toast(mode==='automatic'?'Automatic mode enabled.':'Manual mode enabled.');}catch(err){toast(err.message);}}
$('manualMode').onclick=()=>setMode('manual');$('automaticMode').onclick=()=>setMode('automatic');
document.querySelectorAll('[data-control]').forEach(button=>{const key=button.dataset.control;const toggle=button.hasAttribute('data-toggle');let state=false;button.onpointerdown=e=>{e.preventDefault();if(toggle){state=!state;socket?.emit('control',{key,pressed:state});}else socket?.emit('control',{key,pressed:true});};const up=e=>{e.preventDefault();if(!toggle)socket?.emit('control',{key,pressed:false});};button.onpointerup=up;button.onpointerleave=up;});
document.querySelector('[data-jump]').onclick=()=>socket?.emit('jump');$('stop').onclick=()=>socket?.emit('stop');
function renderInventory(data){const slots=data?.slots||[];$('hotbar').replaceChildren();$('inventoryGrid').replaceChildren();for(let i=0;i<9;i++){const item=slots[36+i];const b=document.createElement('button');b.className='inventory-slot'+(data.selected===i?' active':'');b.textContent=item?item.name+' ×'+item.count:String(i+1);b.onclick=()=>socket?.emit('hotbar',{slot:i});$('hotbar').append(b);}for(let i=9;i<36;i++){const item=slots[i];const b=document.createElement('button');b.className='inventory-slot';b.textContent=item?item.name+' ×'+item.count:'';b.onclick=()=>socket?.emit('inventoryClick',{slot:i});$('inventoryGrid').append(b);}}
let inventoryOpen=false;$('inventoryButton').onclick=()=>{inventoryOpen=!inventoryOpen;$('inventoryPanel').classList.toggle('hidden',!inventoryOpen);if(inventoryOpen)socket?.emit('inventoryRequest');};$('dropButton').onclick=()=>socket?.emit('dropHeld');
let playFocused=false;
function gameKeyDown(e){if(currentMode!=='manual'||!playFocused||e.repeat)return;const map={w:'forward',a:'left',s:'back',d:'right',' ':'jump',shift:'sneak'};const k=e.key.toLowerCase();if(map[k]){e.preventDefault();socket?.emit('control',{key:map[k],pressed:true});}else if(/^[1-9]$/.test(e.key)){e.preventDefault();socket?.emit('hotbar',{slot:Number(e.key)-1});}else if(k==='q'){e.preventDefault();socket?.emit('dropHeld',{stack:e.ctrlKey});}else if(k==='e'){e.preventDefault();$('inventoryButton').click();}}
function gameKeyUp(e){if(currentMode!=='manual'||!playFocused)return;const map={w:'forward',a:'left',s:'back',d:'right',' ':'jump',shift:'sneak'};const k=e.key.toLowerCase();if(map[k]){e.preventDefault();socket?.emit('control',{key:map[k],pressed:false});}}
$('viewerFrame').addEventListener('pointerdown',()=>{playFocused=true;});
$('viewerFrame').addEventListener('load',()=>{try{const doc=$('viewerFrame').contentDocument;doc?.addEventListener('keydown',gameKeyDown);doc?.addEventListener('keyup',gameKeyUp);doc?.addEventListener('pointerdown',()=>{playFocused=true;});const canvas=doc?.querySelector('canvas');if(canvas){canvas.addEventListener('click',()=>{try{canvas.requestPointerLock?.();}catch{}});doc?.addEventListener('mousemove',e=>{if(currentMode!=='manual'||doc.pointerLockElement!==canvas)return;lookYaw-=Number(e.movementX||0)*0.002;lookPitch=Math.max(-1.55,Math.min(1.55,lookPitch+Number(e.movementY||0)*0.002));socket?.emit('look',{yaw:lookYaw,pitch:lookPitch});});}}catch{}});
window.addEventListener('keydown',gameKeyDown);window.addEventListener('keyup',gameKeyUp);

document.querySelectorAll('nav button').forEach(button=>button.onclick=()=>{document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b===button));document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));$(button.dataset.page).classList.remove('hidden');$('heading').textContent=button.textContent.trim();if(button.dataset.page==='play')$('viewerFrame').src='/viewer/?_='+Date.now();else stopViewer();if(button.dataset.page==='memory'){loadMemories();loadSuggestions();}if(button.dataset.page==='settings')loadProviders();});
$('memoryForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/memories',{method:'POST',body:JSON.stringify({content:$('memoryInput').value})});$('memoryInput').value='';loadMemories();toast('Memory saved.');}catch(err){toast(err.message);}};
async function loadMemories(){try{const rows=await api('/api/memories');$('memories').replaceChildren();if(!rows.length)$('memories').textContent='No saved memories.';rows.forEach(row=>{const item=document.createElement('div');item.className='item';const area=document.createElement('textarea');area.value=row.content;const actions=document.createElement('div');actions.className='item-actions';const save=document.createElement('button');save.textContent='Save';save.onclick=async()=>{await api('/api/memories/'+row.id,{method:'PATCH',body:JSON.stringify({content:area.value})});toast('Updated.');};const del=document.createElement('button');del.textContent='Delete';del.onclick=async()=>{if(confirm('Delete this memory?')){await api('/api/memories/'+row.id,{method:'DELETE'});loadMemories();}};actions.append(save,del);item.append(area,actions);$('memories').append(item);});}catch(err){toast(err.message);}}
async function loadSuggestions(){try{const rows=await api('/api/suggestions');$('suggestions').replaceChildren();$('pendingBadge').textContent=rows.length||'';if(!rows.length)$('suggestions').textContent='No pending suggestions.';rows.forEach(row=>{const item=document.createElement('div');item.className='item';const p=document.createElement('p');p.textContent=row.content;const actions=document.createElement('div');actions.className='item-actions';const yes=document.createElement('button');yes.textContent='Approve';yes.onclick=async()=>{await api('/api/suggestions/'+row.id+'/approve',{method:'POST'});loadSuggestions();loadMemories();};const no=document.createElement('button');no.textContent='Reject';no.onclick=async()=>{await api('/api/suggestions/'+row.id+'/reject',{method:'POST'});loadSuggestions();};actions.append(yes,no);item.append(p,actions);$('suggestions').append(item);});}catch(err){toast(err.message);}}
$('providerForm').onsubmit=async e=>{e.preventDefault();const data={name:$('providerName').value,baseUrl:$('providerUrl').value,model:$('providerModel').value,apiKey:$('providerKey').value,priority:Number($('providerPriority').value)};try{await api('/api/providers',{method:'POST',body:JSON.stringify(data)});$('providerForm').reset();$('providerPriority').value='10';loadProviders();toast('Provider added.');}catch(err){toast(err.message);}};
async function loadProviders(){try{const rows=await api('/api/providers');$('providers').replaceChildren();if(!rows.length)$('providers').textContent='No providers configured.';rows.forEach(row=>{const item=document.createElement('div');item.className='item';const p=document.createElement('p');p.textContent=row.name+' · '+row.model+' · priority '+row.priority+' · '+(row.enabled?'enabled':'disabled');const actions=document.createElement('div');actions.className='item-actions';const toggle=document.createElement('button');toggle.textContent=row.enabled?'Disable':'Enable';toggle.onclick=async()=>{await api('/api/providers/'+row.id,{method:'PATCH',body:JSON.stringify({enabled:!row.enabled})});loadProviders();};const del=document.createElement('button');del.textContent='Remove';del.onclick=async()=>{if(confirm('Remove provider?')){await api('/api/providers/'+row.id,{method:'DELETE'});loadProviders();}};actions.append(toggle,del);item.append(p,actions);$('providers').append(item);});}catch(err){toast(err.message);}}
async function loadAll(){try{const v=await api('/api/status');updateStatus(v.bot);applyMode(v.mode||'manual');await Promise.all([loadMemories(),loadSuggestions(),loadProviders()]);}catch(err){toast(err.message);}}
(async()=>{try{await api('/api/status');showApp();}catch{showLogin();}})();
