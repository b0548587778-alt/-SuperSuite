const $=id=>document.getElementById(id);
const store={get(k,d){try{const v=localStorage.getItem('tb_'+k);return v==null?d:JSON.parse(v)}catch{return d}},set(k,v){try{localStorage.setItem('tb_'+k,JSON.stringify(v))}catch{}}};
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),1400)}
async function copy(t){try{await navigator.clipboard.writeText(t);toast('הועתק')}catch{toast('ההעתקה נכשלה')}}
const fmt=n=>Number.isFinite(n)?(+n.toFixed(6)).toLocaleString('en-US',{maximumFractionDigits:6}):'—';

/* מחשבון */
(function(){
const keys=['C','⌫','%','÷','7','8','9','×','4','5','6','−','1','2','3','+','±','0','.','='];
let expr='',hist=store.get('calcHist',[]);if(!Array.isArray(hist))hist=[];
const disp=$('cDisp');
// ההיסטוריה נשמרת ב-localStorage ומשוחזרת מגיבוי — טקסט בלבד (textContent), לא HTML
function show(){disp.textContent=expr||'0';$('cHist').replaceChildren(...hist.slice(-5).reverse().map(h=>{const d=document.createElement('div');d.textContent=String(h);return d}))}
function evalExpr(e){
  const s=e.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-').replace(/(\d+(?:\.\d+)?)%/g,'($1/100)');
  if(!/^[0-9+\-*/().\s]*$/.test(s))throw 0;
  // מנתח רקורסיבי קטן במקום eval
  let i=0;const t=s.replace(/\s/g,'');
  function num(){let neg=1;while(t[i]=='-'||t[i]=='+'){if(t[i]=='-')neg*=-1;i++}
    if(t[i]=='('){i++;const v=add();if(t[i]!=')')throw 0;i++;return neg*v}
    const m=/^\d*\.?\d+/.exec(t.slice(i));if(!m)throw 0;i+=m[0].length;return neg*parseFloat(m[0])}
  function mul(){let v=num();while(t[i]=='*'||t[i]=='/'){const o=t[i++];const r=num();v=o=='*'?v*r:v/r}return v}
  function add(){let v=mul();while(t[i]=='+'||t[i]=='-'){const o=t[i++];const r=mul();v=o=='+'?v+r:v-r}return v}
  const v=add();if(i!=t.length)throw 0;return v}
function press(k){
  if(k=='C')expr='';
  else if(k=='⌫')expr=expr.slice(0,-1);
  else if(k=='±'){expr=expr.startsWith('−')?expr.slice(1):(expr?'−'+expr:expr)}
  else if(k=='='){if(!expr)return;try{const v=evalExpr(expr);if(!Number.isFinite(v))throw 0;const r=+v.toPrecision(12);hist.push(expr+' = '+r);hist=hist.slice(-30);store.set('calcHist',hist);expr=String(r)}catch{expr='שגיאה';show();expr='';return}}
  else expr+=k;
  show()}
$('cKeys').innerHTML=keys.map(k=>`<button data-k="${k}" class="${k=='='?'p':''}">${k}</button>`).join('');
$('cKeys').onclick=e=>{const k=e.target.dataset.k;if(k)press(k)};
document.addEventListener('keydown',e=>{
  if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;
  const m={'*':'×','/':'÷','-':'−','Enter':'=','Backspace':'⌫','Escape':'C'};
  const k=m[e.key]||e.key;
  if(/^[0-9.+%()=]$/.test(k)||['×','÷','−','⌫','C'].includes(k)){e.preventDefault();press(k)}});
show()})();

/* ממיר יחידות */
(function(){
const U={
 'אורך':{base:'מטר',u:{'מילימטר':.001,'סנטימטר':.01,'מטר':1,'קילומטר':1000,'אינץ׳':.0254,'רגל':.3048,'יארד':.9144,'מייל':1609.344}},
 'משקל':{base:'ק״ג',u:{'גרם':.001,'ק״ג':1,'טון':1000,'אונקיה':.028349523,'ליברה':.45359237}},
 'נפח':{base:'ליטר',u:{'מ״ל':.001,'ליטר':1,'מ״ק':1000,'כוס (240 מ״ל)':.24,'כף (15 מ״ל)':.015,'גלון (ארה״ב)':3.785411784}},
 'מהירות':{base:'מ/ש',u:{'מ/ש':1,'קמ״ש':1/3.6,'מייל/ש':.44704,'קשר':.514444}},
 'נפח נתונים':{base:'בייט',u:{'בייט':1,'KB':1024,'MB':1048576,'GB':1073741824,'TB':1099511627776}},
 'טמפרטורה':{temp:true,u:{'צלזיוס':0,'פרנהייט':0,'קלווין':0}}};
const t=$('uType');t.innerHTML=Object.keys(U).map(k=>`<option>${k}</option>`).join('');
function fill(){const names=Object.keys(U[t.value].u);for(const id of['uFrom','uTo'])$(id).innerHTML=names.map(n=>`<option>${n}</option>`).join('');$('uTo').selectedIndex=Math.min(1,names.length-1);calc()}
function calc(){const d=U[t.value],v=parseFloat($('uVal').value),f=$('uFrom').value,to=$('uTo').value;if(isNaN(v)){$('uOut').textContent='—';return}
 let r;if(d.temp){let c=f=='צלזיוס'?v:f=='פרנהייט'?(v-32)*5/9:v-273.15;r=to=='צלזיוס'?c:to=='פרנהייט'?c*9/5+32:c+273.15}
 else r=v*d.u[f]/d.u[to];
 $('uOut').textContent=`${fmt(v)} ${f} = ${fmt(r)} ${to}`}
t.onchange=fill;['uVal','uFrom','uTo'].forEach(i=>$(i).oninput=calc);fill()})();

/* סיסמאות */
(function(){
const sets={pLo:'abcdefghijklmnopqrstuvwxyz',pUp:'ABCDEFGHIJKLMNOPQRSTUVWXYZ',pNu:'0123456789',pSy:'!@#$%^&*()-_=+[]{};:,.?'};
function rnd(n){const a=new Uint32Array(1),lim=Math.floor(2**32/n)*n;let x;do{crypto.getRandomValues(a);x=a[0]}while(x>=lim);return x%n}
function gen(){const act=Object.keys(sets).filter(k=>$(k).checked);if(!act.length){$('pOut').textContent='בחר לפחות סוג תווים אחד';return}
 const L=+$('pLen').value;let chars=[];act.forEach(k=>chars.push(sets[k][rnd(sets[k].length)]));
 const all=act.map(k=>sets[k]).join('');while(chars.length<L)chars.push(all[rnd(all.length)]);
 for(let i=chars.length-1;i>0;i--){const j=rnd(i+1);[chars[i],chars[j]]=[chars[j],chars[i]]}
 $('pOut').textContent=chars.slice(0,L).join('')}
$('pLen').oninput=()=>{$('pLenV').textContent=$('pLen').value;gen()};
Object.keys(sets).forEach(k=>$(k).onchange=gen);$('pGen').onclick=gen;$('pCopy').onclick=()=>copy($('pOut').textContent);gen()})();

/* פתקים */
$('notes').value=store.get('notes','');$('notes').oninput=()=>store.set('notes',$('notes').value);

/* משימות */
(function(){let L=store.get('todos',[]);
function draw(){$('tList').innerHTML=L.map((t,i)=>`<div class="todo ${t.d?'done':''}"><input type="checkbox" data-i="${i}" ${t.d?'checked':''}><span></span><button data-x="${i}">✕</button></div>`).join('')||'<p class="lbl">אין משימות</p>';
 [...$('tList').querySelectorAll('.todo span')].forEach((s,i)=>s.textContent=L[i].t)}
function add(){const v=$('tIn').value.trim();if(!v)return;L.push({t:v,d:false});$('tIn').value='';store.set('todos',L);draw()}
$('tAdd').onclick=add;$('tIn').onkeydown=e=>{if(e.key=='Enter')add()};
$('tList').onclick=e=>{const i=e.target.dataset.i,x=e.target.dataset.x;if(i!=null){L[i].d=e.target.checked}else if(x!=null){L.splice(x,1)}else return;store.set('todos',L);draw()};draw()})();

/* סטופר וטיימר */
(function(){
let t0=0,el=0,run=false,iv,laps=[];
const f=ms=>{const m=Math.floor(ms/60000),s=Math.floor(ms/1000)%60,d=Math.floor(ms/100)%10;return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+'.'+d};
function tick(){$('swD').textContent=f(el+(run?Date.now()-t0:0))}
$('swS').onclick=()=>{if(run){el+=Date.now()-t0;run=false;clearInterval(iv);$('swS').textContent='המשך'}else{t0=Date.now();run=true;iv=setInterval(tick,50);$('swS').textContent='עצור'}};
$('swL').onclick=()=>{if(!run&&!el)return;laps.push(f(el+(run?Date.now()-t0:0)));$('swLaps').innerHTML=laps.map((l,i)=>`<div>הקפה ${i+1}: ${l}</div>`).reverse().join('')};
$('swR').onclick=()=>{run=false;clearInterval(iv);el=0;laps=[];$('swLaps').innerHTML='';$('swS').textContent='התחלה';tick()};
let left=0,tiv,going=false,ctx;
const g=()=>(+$('tmM').value||0)*60+Math.min(59,+$('tmS').value||0);
const tf=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
function beep(){try{ctx=ctx||new AudioContext();[0,.3,.6].forEach(d=>{const o=ctx.createOscillator(),gn=ctx.createGain();o.connect(gn);gn.connect(ctx.destination);o.frequency.value=880;gn.gain.value=.2;o.start(ctx.currentTime+d);o.stop(ctx.currentTime+d+.2)})}catch{}}
['tmM','tmS'].forEach(i=>$(i).oninput=()=>{if(!going){left=g();$('tmD').textContent=tf(left)}});
$('tmGo').onclick=()=>{try{ctx=ctx||new AudioContext();ctx.resume()}catch{}
 if(going){going=false;clearInterval(tiv);$('tmGo').textContent='המשך';return}
 if(!left)left=g();if(!left)return;going=true;$('tmGo').textContent='עצור';
 tiv=setInterval(()=>{left--;$('tmD').textContent=tf(left);if(left<=0){clearInterval(tiv);going=false;$('tmGo').textContent='התחלה';beep();toast('הטיימר הסתיים')}},1000)};
$('tmRst').onclick=()=>{going=false;clearInterval(tiv);left=g();$('tmD').textContent=tf(left);$('tmGo').textContent='התחלה'};
tick()})();

/* טקסט */
(function(){const x=$('txt');
function st(){const v=x.value;$('sW').textContent=(v.trim().match(/\S+/g)||[]).length;$('sC').textContent=[...v].length;$('sN').textContent=[...v.replace(/\s/g,'')].length;$('sL').textContent=v?v.split('\n').length:0}
x.oninput=st;
$('txU').onclick=()=>{x.value=x.value.toUpperCase();st()};$('txLo').onclick=()=>{x.value=x.value.toLowerCase();st()};
$('txSp').onclick=()=>{x.value=x.value.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();st()};
$('txSo').onclick=()=>{x.value=x.value.split('\n').sort((a,b)=>a.localeCompare(b,'he')).join('\n');st()};
$('txDu').onclick=()=>{x.value=[...new Set(x.value.split('\n'))].join('\n');st()};st()})();

/* צבעים */
(function(){
function upd(h){if(!/^#?[0-9a-f]{6}$/i.test(h))return;h=h.replace('#','');const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
 const mx=Math.max(r,g,b)/255,mn=Math.min(r,g,b)/255,l=(mx+mn)/2,d=mx-mn;let hh=0,s=0;
 if(d){s=d/(1-Math.abs(2*l-1));const R=r/255,G=g/255,B=b/255;hh=mx==R?((G-B)/d)%6:mx==G?(B-R)/d+2:(R-G)/d+4;hh=Math.round(hh*60);if(hh<0)hh+=360}
 $('colS').style.background='#'+h;
 $('colO').innerHTML=`#${h.toUpperCase()}<br>rgb(${r}, ${g}, ${b})<br>hsl(${hh}, ${Math.round(s*100)}%, ${Math.round(l*100)}%)`;
 $('colO').onclick=()=>copy('#'+h.toUpperCase())}
$('colP').oninput=()=>{$('colH').value=$('colP').value;upd($('colP').value)};
$('colH').oninput=()=>{upd($('colH').value);if(/^#[0-9a-f]{6}$/i.test($('colH').value))$('colP').value=$('colH').value};
upd('#2b5fd9')})();

/* מע״מ */
// באגורות שלמות (calc.js → vatCalc), המע"מ מעוגל לאגורה ומוצג בשתי ספרות
(function(){const ils=ag=>'₪'+(ag/100).toLocaleString('he-IL',{minimumFractionDigits:2,maximumFractionDigits:2});
 const line=t=>{const d=document.createElement('div');d.textContent=t;return d};
 function c(){const v=window.ToolsCalc.vatCalc($('vA').value,$('vR').value);
 if(!v){$('vO').replaceChildren(line('סכום או שיעור לא תקינים (עד 2 ספרות אחרי הנקודה)'));return}
 $('vO').replaceChildren(line(`הוספת מע״מ: ${ils(v.addTotalAg)} (מע״מ ${ils(v.addVatAg)})`),line(`הסרת מע״מ: ${ils(v.removeNetAg)} (מע״מ ${ils(v.removeVatAg)})`))}
['vA','vR'].forEach(i=>$(i).oninput=c);c()})();

/* תאריך עברי */
(function(){$('hD').value=window.ToolsCalc.localDay();
function c(){const v=$('hD').value;if(!v)return;const dt=new Date(v+'T12:00:00');
 const h=new Intl.DateTimeFormat('he-u-ca-hebrew',{day:'numeric',month:'long',year:'numeric'}).format(dt);
 const w=new Intl.DateTimeFormat('he',{weekday:'long'}).format(dt);$('hO').textContent=`${w}, ${h}`}
$('hD').oninput=c;c()})();

/* הלוואה */
(function(){function c(){const P=+$('lA').value,r=+$('lR').value/1200,n=+$('lY').value*12;if(!(P>0&&n>0)){$('lO').textContent='—';return}
 const m=r?P*r/(1-Math.pow(1+r,-n)):P/n;$('lO').innerHTML=`החזר חודשי: <b>${fmt(Math.round(m*100)/100)}</b><br>סך הכול: ${fmt(Math.round(m*n))}<br>ריבית כוללת: ${fmt(Math.round(m*n-P))}`}
['lA','lR','lY'].forEach(i=>$(i).oninput=c);c()})();

/* JSON / Base64 */
(function(){const o=$('jOut'),i=$('jIn');
const u8=s=>btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const un=s=>new TextDecoder().decode(Uint8Array.from(atob(s),c=>c.charCodeAt(0)));
const t=f=>()=>{try{o.textContent=f(i.value)}catch(e){o.textContent='שגיאה: '+(e.message||'קלט לא תקין')}};
$('jFmt').onclick=t(s=>JSON.stringify(JSON.parse(s),null,2));$('jMin').onclick=t(s=>JSON.stringify(JSON.parse(s)));
$('b64e').onclick=t(u8);$('b64d').onclick=t(un);o.onclick=()=>copy(o.textContent)})();

/* אחוזים */
(function(){function c(){const a=+$('p1a').value,b=+$('p1b').value;$('p1o').textContent=fmt(a*b/100);
 $('p2o').textContent=fmt(+$('p2a').value/+$('p2b').value*100)+'%';
 const x=+$('p3a').value,y=+$('p3b').value;$('p3o').textContent=x?fmt((y-x)/Math.abs(x)*100)+'%':'—'}
['p1a','p1b','p2a','p2b','p3a','p3b'].forEach(i=>$(i).oninput=c);c()})();

/* ---------- כלים נוספים ---------- */
(function(){
  const C=window.ToolsCalc, money=n=>'₪'+Number(n).toLocaleString('he-IL',{minimumFractionDigits:2,maximumFractionDigits:2});
  const err=(el,e)=>{el.textContent='שגיאה: '+(e.message||e)};
  $('slBtn').onclick=()=>{const g=C.groupShoppingList($('sl').value);$('slOut').textContent=g.length?C.shoppingListText(g):'הרשימה ריקה'};
  $('slCopy').onclick=async()=>{try{await navigator.clipboard.writeText($('slOut').textContent);$('slCopy').textContent='הועתק ✓';setTimeout(()=>$('slCopy').textContent='העתק',1200)}catch{}};
  const pw=()=>{try{const r=C.powerCost({watts:$('pw').value,hoursPerDay:$('ph').value,pricePerKwh:$('pk').value,days:$('pd').value});
    $('pwOut').textContent=`צריכה: ${r.kwhPerDay} קוט"ש ביום · עלות ליום ${money(r.costPerDay)} · עלות לתקופה ${money(r.costPeriod)} (${r.kwhPeriod} קוט"ש)`}catch(e){err($('pwOut'),e)}};
  const dd=()=>{try{const r=C.dateDiff($('dA').value,$('dB').value);$('dOut').textContent=`${r.days} ימים · ${r.weeks} שבועות · כ-${r.months} חודשים`}catch(e){err($('dOut'),e)}};
  const da=()=>{try{$('dAdd').textContent='התאריך: '+C.addDays($('dX').value,$('dN').value)}catch(e){err($('dAdd'),e)}};
  const ci=()=>{try{const r=C.compoundInterest({principal:$('ciP').value,monthlyDeposit:$('ciM').value,annualRate:$('ciR').value,years:$('ciY').value});
    $('ciOut').textContent=`סה"כ צפוי: ${money(r.final)} · הפקדתם: ${money(r.deposited)} · ריבית שנצברה: ${money(r.interest)}`}catch(e){err($('ciOut'),e)}};
  ['pw','ph','pk','pd'].forEach(i=>$(i).oninput=pw); ['dA','dB'].forEach(i=>$(i).onchange=dd);
  ['dN','dX'].forEach(i=>$(i).onchange=da); ['ciP','ciM','ciR','ciY'].forEach(i=>$(i).oninput=ci);
  pw(); ci(); (()=>{const t=C.localDay();$('dA').value=t;$('dX').value=t;$('dB').value=C.addDays(t,30);dd();da()})();
})();

/* ---------- כלים לקהל היעד (PLAN.md 9.12) ---------- */
(function(){
  const C=window.ToolsCalc;
  const ils=ag=>'₪'+(ag/100).toLocaleString('he-IL',{minimumFractionDigits:2,maximumFractionDigits:2});
  const err=(el,e)=>{el.textContent='שגיאה: '+(e.message||e)};
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};

  // שכר: טבלה מקובץ שנשמרה (נבדקת שוב בכל טעינה), אחרת המובנית
  let table=C.SALARY_TABLE_DEFAULT;
  try{const saved=store.get('salaryTable',null);if(saved)table=C.parseSalaryTable(saved)}catch{store.set('salaryTable',null)}
  const sg=()=>{
    $('sgW').textContent=(table.verified?'':'⚠ ')+`טבלה לשנת ${table.year}`+(table.note?' — '+table.note:(table.verified?'':' — לא מאומתת: לבדוק מול מחשבון רשות המסים לפני הסתמכות.'));
    try{const r=C.netSalary({gross:$('sgG').value,creditPoints:$('sgC').value,pensionPct:$('sgP').value,table});
      $('sgO').innerHTML=`נטו משוער: <b>${ils(r.netAg)}</b><br>מס הכנסה ${ils(r.incomeTaxAg)} (אחרי זיכוי ${ils(r.creditAg)}) · ביטוח לאומי ${ils(r.bituachAg)} · בריאות ${ils(r.healthAg)} · פנסיה ${ils(r.pensionAg)}<br>`+
        r.steps.map(s=>`מדרגה ${s.rate}%: ${ils(s.partAg)} ← ${ils(s.taxAg)}`).join(' · ')}catch(e){err($('sgO'),e)}};
  ['sgG','sgC','sgP'].forEach(i=>$(i).oninput=sg);
  $('sgFile').onclick=()=>$('sgIn').click();
  $('sgIn').onchange=async e=>{const f=e.target.files&&e.target.files[0];e.target.value='';if(!f)return;
    try{if(f.size>32768)throw new Error('הקובץ גדול מדי');const t=C.parseSalaryTable(await f.text());table=t;store.set('salaryTable',t);toast('הטבלה נטענה');sg()}catch(x){toast('הטבלה לא נטענה: '+x.message)}};
  $('sgReset').onclick=()=>{table=C.SALARY_TABLE_DEFAULT;store.set('salaryTable',null);sg()};
  sg();

  // מעשרות
  let M=store.get('maaser',[]);if(!Array.isArray(M))M=[];
  const rate=()=>Number((document.querySelector('input[name="mR"]:checked')||{}).value||store.get('maaserRate',10));
  const mDraw=()=>{try{const r=C.maaserSummary(M,rate());
      $('mO').innerHTML=`הכנסות ${ils(r.incomeAg)} · ${r.rate}% = ${ils(r.dueAg)} · ניתן ${ils(r.givenAg)}<br><b>${r.balanceAg>0?'נותר לתת: '+ils(r.balanceAg):r.balanceAg<0?'ניתן מעבר לחשבון: '+ils(-r.balanceAg):'מאוזן'}</b>`+
        (r.years.length>1?'<br>'+r.years.map(y=>`${esc(y.year)}: הכנסות ${ils(y.incomeAg)}, ניתן ${ils(y.givenAg)}`).join('<br>'):'');
    }catch(e){err($('mO'),e)}
    $('mList').innerHTML=M.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,100).map(e=>`<div>${e.kind==='income'?'➕ הכנסה':'➖ נתינה'} ${ils(e.amountAg)} · ${esc(e.date)}${e.note?' · '+esc(e.note):''} <button data-mx="${esc(e.id)}" aria-label="מחיקת רשומה">✕</button></div>`).join('')};
  document.querySelectorAll('input[name="mR"]').forEach(r=>{if(Number(r.value)===store.get('maaserRate',10))r.checked=true;r.onchange=()=>{store.set('maaserRate',rate());mDraw()}});
  $('mD').value=today();
  $('mAdd').onclick=()=>{try{M.push(C.newMaaserEntry({kind:$('mK').value,amount:$('mA').value,date:$('mD').value,note:$('mN').value}));store.set('maaser',M);$('mA').value='';$('mN').value='';mDraw()}catch(e){toast(e.message)}};
  $('mList').onclick=async e=>{const id=e.target.dataset.mx;if(!id||!(await ssDialog.confirm('למחוק את הרשומה?',{danger:true})))return;M=M.filter(x=>x.id!==id);store.set('maaser',M);mDraw()};
  mDraw();

  // הצמדה למדד
  const ix=()=>{try{const r=C.indexLinkage({amount:$('ixA').value,baseIndex:$('ixB').value,currentIndex:$('ixC').value,floor:$('ixF').checked});
    $('ixO').innerHTML=`סכום צמוד: <b>${ils(r.linkedAg)}</b> · הפרש ${ils(r.diffAg)} · שינוי במדד ${r.changePct}%`}catch(e){err($('ixO'),e)}};
  ['ixA','ixB','ixC'].forEach(i=>$(i).oninput=ix);$('ixF').onchange=ix;ix();

  // גימטריה
  const gm=()=>{const r=C.gematria($('gmT').value,{finals:$('gmF').checked});
    $('gmO').innerHTML=r.total?`סך הכול: <b>${r.total}</b>`+(r.words.length>1?'<br>'+r.words.slice(0,50).map(w=>`${esc(w.word)} = ${w.value}`).join(' · '):''):'אין אותיות עבריות'};
  const gh=()=>{try{$('gmH').textContent=C.numberToHebrew(+$('gmN').value)}catch(e){err($('gmH'),e)}};
  $('gmT').oninput=gm;$('gmF').onchange=gm;$('gmN').oninput=gh;gm();gh();

  // הבראה ופיצויים
  const hv=()=>{try{const r=C.havraa({years:$('hvY').value,jobPct:$('hvP').value,dayRate:$('hvR').value});
    $('hvO').innerHTML=r.eligible?`${r.days} ימי הבראה לשנה · <b>${ils(r.amountAg)}</b>`:'הזכאות מתחילה אחרי שנת עבודה מלאה'}catch(e){err($('hvO'),e)}};
  const sv=()=>{try{const r=C.severance({salary:$('svS').value,from:$('svA').value,to:$('svB').value});
    $('svO').innerHTML=`ותק ${r.years} שנים · פיצויים: <b>${ils(r.amountAg)}</b>`+(r.eligible?'':'<br>בדרך כלל הזכאות לפיצויים מתחילה אחרי שנת עבודה')}catch(e){err($('svO'),e)}};
  ['hvY','hvP','hvR'].forEach(i=>$(i).oninput=hv);['svS','svA','svB'].forEach(i=>$(i).oninput=sv);
  $('svB').value=today();hv();sv();
})();
