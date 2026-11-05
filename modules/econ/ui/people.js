// ממשק המודול הכלכלי — מאגר אנשים.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// מאגר אנשים — כרטיס אחד לכל אדם: תרומות, הוראות קבע, הנצחות, גמ"ח וחסד. קריאה בלבד;
// העריכה נעשית במסך של כל מודול. השיוך לפי ת.ז, ובלי ת.ז — לפי שם (ומסומן).
// ============================================================
function renderPeople(o) {
  if (!o || !Array.isArray(o.rows)) return renderEmpty('אין נתונים להצגה');
  const q = state.peopleQuery || '';
  // כותרת משנה ופעולות בשורה אחת — כמו במסכי העמותה והגמ"ח (בלי לחזור על כותרת המסך)
  return `<div class="acct">
    <div class="acct-header">
      <div>
        <h3>חיפוש אנשים</h3>
        <small class="muted">כל מי שמופיע בעמותה, בהוראות הקבע, בהנצחות, בגמ"ח או בחסד — בכרטיס אחד. השיוך נעשה לפי ת.ז; רשומה בלי ת.ז משויכת לפי שם ומסומנת. לעריכה — במסך של כל תחום.</small>
      </div>
      <form id="peopleSearch" class="acct-actions" autocomplete="off">
        <input type="search" id="peopleQ" value="${esc(q)}" placeholder="חיפוש לפי שם, ת.ז או טלפון" style="min-width:260px">
        <button class="primary" type="submit">חיפוש</button>
      </form>
    </div>
    <div class="card acct-wide">
      <h3>${Number(o.total)} אנשים${o.truncated ? ` <small class="muted">(מוצגים ${o.rows.length} הראשונים — צמצם את החיפוש)</small>` : ''}</h3>
      ${o.rows.length === 0 ? renderEmpty(q ? 'לא נמצאו תוצאות — בדקו את האיות, או חפשו לפי מספר זהות' : 'אין עדיין אנשים במערכת — אנשים נוספים לכאן מעצמם כשרושמים תרומה, הלוואה בגמ"ח או נזקק בחסד') : `<div class="acct-scroll"><table class="acct-table">
        <thead><tr><th>שם</th><th>ת.ז</th><th>טלפון</th><th>תפקידים</th><th>תרומות</th><th>גמ"ח</th><th></th></tr></thead>
        <tbody>${o.rows.map(p => `<tr>
          <td>${esc(p.name)}${p.nameOnly ? ` <small class="muted" title="${p.ambiguous ? 'יש כמה אנשים עם ת.ז בשם הזה — לא שויך' : 'אין ת.ז — זוהה לפי שם'}">· לפי שם${p.ambiguous ? ' (כמה אפשרויות)' : ''}</small>` : ''}</td>
          <td>${esc(p.idNumber)}</td><td><small>${esc(p.phones.join(', '))}</small></td>
          <td><small>${esc(p.roleLabels.join(' · '))}</small></td>
          <td>${p.donationsCount ? money(p.donationsTotal) : '—'}</td>
          <td>${p.activeLoansOutstanding ? money(p.activeLoansOutstanding) : ''}${p.activeGuarantees ? ` <small class="muted">ערב ל-${Number(p.activeGuarantees)}</small>` : ''}${p.late ? ' <small class="bad">· פיגור</small>' : ''}${p.itemsOut ? ` <small class="muted">· ${Number(p.itemsOut)} חפצים בהשאלה</small>` : ''}</td>
          <td><button class="icon-btn" data-person="${esc(p.key)}" title="כרטיס">👤</button></td>
        </tr>`).join('')}</tbody></table></div>`}
    </div>
  </div>`;
}

function personCardHtml(c) {
  const sec = (title, items, row) => items.length ? `<h4>${esc(title)} (${items.length})</h4>${items.map(row).join('')}` : '';
  const byName = (x) => x.byName ? ' <small class="muted" title="שויך לפי שם — אין ת.ז ברשומה">· לפי שם</small>' : '';
  return `<h2>${esc(c.name)}</h2>
    <div class="acct-scroll" style="max-height:65vh;padding:0 1.5rem">
      <p class="muted">${c.idNumber ? 'ת.ז ' + esc(c.idNumber) : 'ללא ת.ז'}${c.phones.length ? ' · ' + esc(c.phones.join(', ')) : ''}${c.otherNames.length ? ' · מופיע גם כ: ' + esc(c.otherNames.join(', ')) : ''}</p>
      ${sec('תרומות', c.donations, d => `<div class="acct-row ${d.cancelled ? 'muted' : ''}"><span>${esc(d.date)} · קבלה ${esc(d.receipt)}${d.cancelled ? ' · בוטלה' : ''}${byName(d)}</span><span>${money(d.amount)}</span></div>`)}
      ${sec('הוראות קבע', c.standing, s => `<div class="acct-row"><span>${esc(s.startMonth)}${s.endMonth ? ' – ' + esc(s.endMonth) : ' ואילך'}${byName(s)}</span><span>${money(s.amount)} לחודש</span></div>`)}
      ${sec('הנצחות (איש קשר)', c.memorials, m => `<div class="acct-row"><span>${esc(m.deceased)}${byName(m)}</span><span></span></div>`)}
      ${sec('הלוואות גמ"ח', c.loans, l => `<div class="acct-row"><span>${esc(l.issueDate)} · ${esc(l.status)}${l.lateCount ? ` <small class="bad">· ${Number(l.lateCount)} בפיגור</small>` : ''}${byName(l)}</span><span>${money(l.amount)}${l.active ? ' · נותר ' + money(l.outstanding) : ''}</span></div>`)}
      ${sec('ערבות בגמ"ח', c.guarantees, l => `<div class="acct-row"><span>ללווה ${esc(l.borrower)} · ${esc(l.status)}${l.lateCount ? ' <small class="bad">· בפיגור</small>' : ''}${byName(l)}</span><span>${money(l.amount)}</span></div>`)}
      ${sec('הפקדות בגמ"ח', c.deposits, d => `<div class="acct-row"><span>${esc(d.date)}${byName(d)}</span><span>${money(d.amount)}</span></div>`)}
      ${sec('גמ"ח חפצים', c.lendings || [], l => `<div class="acct-row"><span>${esc(l.item)} · ${esc(l.date)}${byName(l)}</span><span>${l.returned ? '<small class="muted">הוחזר</small>' : l.overdue ? `<small class="bad">באיחור (עד ${esc(l.dueDate)})</small>` : `<small>בהשאלה${l.dueDate ? ' עד ' + esc(l.dueDate) : ''}</small>`}</span></div>`)}
      ${sec('חסד — נתמכים', c.beneficiary, b => `<div class="acct-row"><span>משפחת ${esc(b.family)}${b.confidential ? ' <small class="bad">· חסוי</small>' : ''}${b.active ? '' : ' · לא פעיל'}${byName(b)}</span><span></span></div>`)}
      ${sec('חסד — מתנדב', c.volunteer, v => `<div class="acct-row"><span>${esc(v.area || '—')}${v.active ? '' : ' · לא פעיל'}${byName(v)}</span><span></span></div>`)}
    </div>
    <div class="modal-actions"><button type="button" class="primary">סגירה</button></div>`;
}

function attachPeopleHandlers() {
  const form = document.getElementById('peopleSearch');
  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    state.peopleQuery = document.getElementById('peopleQ').value.trim();
    switchView('people');
  });
  document.querySelectorAll('[data-person]').forEach(b => b.addEventListener('click', async () => {
    let c;
    try { c = await window.systemAPI.getPersonCard(b.dataset.person); }
    catch (error) { return showError('שגיאה בטעינת הכרטיס: ' + errMsg(error)); }
    await openDialog((card, finish) => {
      card.style.maxWidth = '640px';
      card.innerHTML = personCardHtml(c);
      card.querySelector('.modal-actions button').addEventListener('click', () => finish(true));
    });
  }));
}
