'use strict';
const {stations, km, trains, base} = Rail;
const $ = id => document.getElementById(id)
  , hh = t => {
    const sec = Math.floor(t * 60 + 1e-6) + 28800;
    return `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;
}
;
let plan = base
  , time = 10
  , running = true
  , selected = '001'
  , wagon = 1
  , compare = false
  , speed = 60
  , events = []
  , history = []
  , replayIndex = null
  , pending = null
  , planRevision = 1;
let logs = [{
    at: 10,
    text: 'Симулятор запущен с 08:10. План загружен; канал 1 Гц.'
}];
let link = {
    online: true,
    seq: 0,
    last: performance.now(),
    failUntil: 0,
    retryAt: 0,
    attempt: 0
};
const uiTime = () => replayIndex === null ? time : history[replayIndex].time
  , viewPlan = () => replayIndex === null ? plan : history[replayIndex].plan
  , viewEvents = () => replayIndex === null ? events : history[replayIndex].events;
const state = (tr, t=uiTime(), p=viewPlan()) => Rail.state(tr, t, p);
function log(text) {
    logs.unshift({
        at: time,
        text
    });
    logs = logs.slice(0, 12);
}
function record() {
    history.push({
        time,
        plan,
        events,
        revision: planRevision,
        seq: link.seq
    });
    while (history.length > 1 && history[1].time < time - 15)
        history.shift();
}
function pick(id) {
    selected = id;
    wagon = 1;
    render();
}
function railY(xx, lane) {
    const near = Math.min(...stations.map( (_, i) => Math.abs(xx - (95 + i * 202.5))));
    const height = 65 + lane * 34;
    return near <= 46 ? height : near >= 87 ? 180 : height + (180 - height) * (1 - Math.cos(Math.PI * (near - 46) / 41)) / 2;
}
function trainShape(tr) {
    let s = `<path d="M-13 -7H-3Q4 -7 6 0Q4 7 -3 7H-13Z" fill="${tr.color}" stroke="#244d59" stroke-width="1"/><path d="M-2 -5L1 -3V3L-2 5Z" fill="#d3eff6"/><rect x="-11" y="-4" width="5" height="8" rx="1" fill="#ffffff" opacity=".3"/><circle cx="4" cy="-3" r="1" fill="#fff1b1"/><circle cx="4" cy="3" r="1" fill="#fff1b1"/>`;
    return s;
}
function map() {
    let s = '<defs><pattern id="sleepers" width="10" height="12" patternUnits="userSpaceOnUse"><path d="M3 0V12" stroke="#b1b8b8" stroke-width="3"/></pattern></defs><rect x="8" y="173" width="984" height="14" fill="url(#sleepers)"/><path d="M8 175H992M8 185H992" stroke="#718892" stroke-width="2"/>';
    stations.forEach( (name, i) => {
        const xx = 95 + i * 202.5;
        for (let lane = 0; lane < 3; lane++) {
            let d = '';
            for (let dx = -87; dx <= 87; dx += 2)
                d += `${dx === -87 ? 'M' : 'L'}${xx + dx},${railY(xx + dx, lane)}`;
            s += `<path d="${d}" fill="none" stroke="#dce5e8" stroke-width="9"/><path d="${d}" fill="none" stroke="#8da2aa" stroke-width="1.5"/>`;
        }
        s += `<text x="${xx}" y="249" text-anchor="middle" fill="#344f5a" font-weight="600" font-size="14">${name}</text><text x="${xx}" y="268" text-anchor="middle" fill="#94a3ab" font-size="12">${km[i]} км</text>`;
    }
    );
    for (let e = 0; e < 4; e++) {
        const blocked = viewEvents().filter(ev => ev.edge === e)
          , closed = blocked.some(ev => uiTime() >= ev.start && uiTime() < ev.end);
        if (closed)
            s += `<path d="M${95 + e * 202.5 + 87} 180H${95 + (e + 1) * 202.5 - 87}" stroke="#db8851" stroke-width="9"/>`;
        s += `<text x="${196 + e * 202.5}" y="214" text-anchor="middle" fill="${blocked.length ? '#bc783e' : '#8fa1ab'}" font-size="11">${blocked.length ? 'Есть ограничение' : '45 км'}</text>`;
    }
    trains.forEach( (tr, i) => {
        s += `<g class="svgtrain" data-train="${tr.id}" tabindex="0" role="button" aria-label="Поезд ${tr.id}, ${tr.n} вагонов"><title>№ ${tr.id} · ${tr.type} · ${tr.n} вагонов</title><g id="label-${tr.id}"><rect x="-30" y="-29" width="60" height="18" rx="4" fill="${selected === tr.id ? tr.color : 'white'}" stroke="${tr.color}"/><text y="-16" text-anchor="middle" fill="${selected === tr.id ? 'white' : tr.color}" font-size="11" font-weight="600">№ ${tr.id}</text></g>`;
        for (let car = 1; car <= 4; car++)
            s += `<path id="coupler-${tr.id}-${car}" fill="none" stroke="#344d59" stroke-width="2"/>`;
        for (let car = 4; car >= 0; car--) {
            s += `<g id="car-${tr.id}-${car}" class="train-unit">${car === 0 ? trainShape(tr) : `<rect x="-13" y="-6" width="13" height="12" rx="2" fill="${tr.color}" stroke="#244d59" stroke-width=".8"/>${tr.priority === 2 ? '<rect x="-11" y="-4" width="9" height="8" rx="1" fill="#574b3b"/><path d="M-10 -2h7m-7 4h7" stroke="#8a785c"/>' : '<path d="M-11 -3h2m2 0h2m2 0h2M-11 3h2m2 0h2m2 0h2" stroke="#def4fa" stroke-width="2"/>'}`}</g>`;
        }
        s += '</g>';
    }
    );
    $('map').innerHTML = s;
    moveTrains();
    document.querySelectorAll('[data-train]').forEach(el => {
        el.onclick = () => pick(el.dataset.train);
        el.onkeydown = e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                pick(el.dataset.train);
            }
        }
        ;
    }
    );
}
// Parameterize each track by distance along the rails, not horizontal offset.
const railPaths = Array.from({
    length: 3
}, (_, lane) => {
    const pts = [];
    let distance = 0
      , prev = null;
    for (let xx = -100; xx <= 1100; xx += .25) {
        const yy = railY(xx, lane);
        if (prev)
            distance += Math.hypot(xx - prev.x, yy - prev.y);
        const p = {
            x: xx,
            y: yy,
            s: distance
        };
        pts.push(p);
        prev = p;
    }
    return pts;
}
);
function railDistanceAtX(xx, lane) {
    const pts = railPaths[lane]
      , f = Math.max(0, Math.min(pts.length - 1, (xx + 100) * 4))
      , i = Math.floor(f)
      , next = pts[Math.min(i + 1, pts.length - 1)];
    return pts[i].s + (next.s - pts[i].s) * (f - i);
}
function railPoint(distance, lane) {
    const pts = railPaths[lane];
    distance = Math.max(0, Math.min(pts[pts.length - 1].s, distance));
    let low = 0
      , high = pts.length - 1;
    while (high - low > 1) {
        const mid = (low + high) >> 1;
        if (pts[mid].s < distance)
            low = mid;
        else
            high = mid;
    }
    const a = pts[low]
      , b = pts[high]
      , f = (distance - a.s) / (b.s - a.s || 1);
    return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f
    };
}
function trainPositions(tr, i) {
    const st = state(tr)
      , lane = i % 3
      , front = railDistanceAtX(95 + st.pos * 202.5, lane);
    return Array.from({
        length: 5
    }, (_, car) => {
        const distance = front - tr.dir * car * 17
          , p = railPoint(distance, lane)
          , back = railPoint(distance - tr.dir * 13, lane);
        const angle = Math.atan2(p.y - back.y, p.x - back.x);
        return {
            x: p.x,
            y: p.y,
            angle,
            distance,
            rear: {
                x: p.x - 13 * Math.cos(angle),
                y: p.y - 13 * Math.sin(angle)
            }
        };
    }
    );
}
function moveTrains() {
    trains.forEach( (tr, i) => {
        const positions = trainPositions(tr, i);
        positions.forEach( (p, car) => {
            $(`car-${tr.id}-${car}`)?.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${p.angle * 180 / Math.PI})`);
            if (car) {
                const back = positions[car - 1].rear;
                $(`coupler-${tr.id}-${car}`)?.setAttribute('d', `M${p.x} ${p.y}L${back.x} ${back.y}`);
            }
        }
        );
        const p = positions[0];
        $(`label-${tr.id}`)?.setAttribute('transform', `translate(${p.x} ${p.y})`);
    }
    );
}
function detail() {
    const tr = trains.find(t => t.id === selected)
      , st = state(tr)
      , p = viewPlan()
      , leg = p[tr.id][st.leg]
      , pr = Rail.profile(tr, leg.mode)
      , fast = Rail.profile(tr, 'fast')
      , m = Rail.motion(pr, Math.max(0, (uiTime() - leg.dep) * 60));
    $('trainDetail').innerHTML = `<div class="trainhead"><h2>Выбранный поезд</h2><span class="pill">${st.status}</span></div><div class="trainnum" style="color:${tr.color}">№ ${tr.id} <span style="font-size:13px;font-weight:400;color:#8596a0">${tr.type}</span></div><div class="route">${tr.dir === 1 ? 'Астана → Караганда' : 'Караганда → Астана'}</div><div class="trainstats"><div><small>Скорость</small><strong>${Math.round(st.speed)} <small style="display:inline">км/ч</small></strong></div><div><small>Прибытие</small><strong>${hh(p[tr.id][3].arr)}</strong></div><div><small>Вагонов</small><strong>${tr.n}</strong></div><div><small>Позиция</small><strong>${(st.pos * 45).toFixed(1)} <small style="display:inline">км</small></strong></div></div><h2 style="font-size:13px">Состав · выберите вагон</h2><div class="wagons">${Array.from({
        length: tr.n
    }, (_, i) => `<button class="wagon ${wagon === i + 1 ? 'chosen' : ''}" data-wagon="${i + 1}" aria-label="Вагон ${i + 1}" title="Вагон ${i + 1}"></button>`).join('')}</div><div class="wagondetail">Вагон ${wagon} / ${tr.n} · ${tr.priority === 2 ? 'Полувагон · уголь · 68 т' : 'Пассажирский · ' + (wagon % 3 === 0 ? 'купе' : 'плацкарт')}<br>Учебная карточка · состояние: исправен</div>`;
    document.querySelectorAll('[data-wagon]').forEach(el => el.onclick = () => {
        wagon = +el.dataset.wagon;
        detail();
    }
    );
    $('atoTitle').textContent = `Автоведение · поезд № ${tr.id}`;
    $('atoLeg').textContent = `${stations[leg.from]} — ${stations[leg.to]} · ${leg.mode === 'eco' ? 'экономичный' : 'быстрый'} режим`;
    let svg = '';
    const x = d => 42 + d / 45000 * 490
      , y = v => 145 - v / (tr.speed / 3.6) * 115;
    for (let v = 0; v <= tr.speed; v += 30)
        svg += `<path d="M42 ${y(v / 3.6)}H532" stroke="#e6edf0"/><text x="33" y="${y(v / 3.6) + 4}" text-anchor="end" font-size="11" fill="#8296a1">${v}</text>`;
    function curve(profile) {
        let d = '';
        for (let i = 0; i <= 100; i++) {
            const a = Rail.motion(profile, profile.duration * i / 100);
            d += `${i ? 'L' : 'M'}${x(a.d)} ${y(a.v)}`;
        }
        return d;
    }
    svg += `<path d="${curve(fast)}" fill="none" stroke="#abbac2" stroke-width="2" stroke-dasharray="5 4"/><path d="${curve(pr)}" fill="none" stroke="${tr.color}" stroke-width="3"/>`;
    for (let d = 0; d <= 45; d += 15)
        svg += `<text x="${x(d * 1000)}" y="169" text-anchor="middle" font-size="11" fill="#8296a1">${d} км</text>`;
    svg += `<text x="42" y="16" fill="#718b97" font-size="11">км/ч</text><circle cx="${x(m.d)}" cy="${y(m.v)}" r="5" fill="${tr.color}" stroke="white" stroke-width="2"/>`;
    $('atoChart').innerHTML = svg;
    $('atoStats').innerHTML = `<div><small>Рекомендация</small><strong>${st.speed ? st.phase : st.status === 'Прибыл' ? 'Остановиться' : 'Ожидать отправления'}</strong></div><div><small>Крейсерская скорость</small><strong>${Math.round(pr.v * 3.6)} км/ч</strong></div><div><small>Энергия перегона, модель</small><strong>${Math.round(pr.energy)} кВт·ч</strong></div><div><small>К быстрому профилю</small><strong>−${(100 * (1 - pr.energy / fast.energy)).toFixed(1)}%</strong></div>`;
    $('atoAssumptions').textContent = `Масса ${tr.mass} т · разгон ${pr.a} м/с² · торможение ${pr.b} м/с² · КПД 88%. Ровный путь, без ветра, уклонов и рекуперации. Экономичный профиль использует резерв времени 12%. Пунктир — быстрый режим. Расчёт учебный, не отраслевой норматив.`;
}
function chart() {
    const p = viewPlan()
      , evs = viewEvents()
      , horizon = Math.max(540, Math.ceil(Math.max(...trains.map(t => p[t.id][3].arr)) / 60) * 60)
      , x = t => 98 + t / horizon * 987
      , y = p => 228 - p * 46;
    let s = '';
    for (let i = 0; i < 5; i++)
        s += `<line x1="98" x2="1085" y1="${y(i)}" y2="${y(i)}" stroke="#e9eef1"/><text x="85" y="${y(i) + 4}" text-anchor="end" fill="#81939c" font-size="11">${stations[i]}</text>`;
    for (let t = 0; t <= horizon; t += 60)
        s += `<line x1="${x(t)}" x2="${x(t)}" y1="35" y2="228" stroke="#f0f3f5"/><text x="${x(t)}" y="255" text-anchor="middle" fill="#94a1aa" font-size="11">${hh(t)}</text>`;
    for (const ev of evs)
        if (ev.edge !== undefined)
            s += `<rect x="${x(ev.start)}" y="${y(ev.edge + 1)}" width="${x(ev.end) - x(ev.start)}" height="46" fill="#f7d5b0" opacity=".5"/>`;
    function path(tr, p) {
        let d = `M${x(0)} ${y(tr.dir === 1 ? 0 : 4)}`;
        for (const l of p[tr.id]) {
            d += `L${x(l.dep)} ${y(l.from)}`;
            for (let i = 1; i <= 20; i++) {
                const tt = l.dep + (l.arr - l.dep) * i / 20
                  , m = Rail.motion(Rail.profile(tr, l.mode), (tt - l.dep) * 60);
                d += `L${x(tt)} ${y(l.from + tr.dir * m.d / 45000)}`;
            }
        }
        return d;
    }
    trains.forEach(tr => {
        if (compare)
            s += `<path d="${path(tr, base)}" fill="none" stroke="${tr.color}" opacity=".25" stroke-width="2" stroke-dasharray="5 5"/>`;
        s += `<path d="${path(tr, p)}" fill="none" stroke="${tr.color}" stroke-width="${selected === tr.id ? 3 : 1.7}" opacity="${selected === tr.id ? 1 : .65}"/><text x="${x(p[tr.id][0].dep) + 5}" y="${y(p[tr.id][0].from) + (tr.dir === 1 ? -7 : 14)}" fill="${tr.color}" font-size="11">${tr.id}</text>`;
    }
    );
    s += `<line x1="${x(uiTime())}" x2="${x(uiTime())}" y1="25" y2="230" stroke="#244d59" stroke-dasharray="4 3"/><rect x="${x(uiTime()) - 23}" y="7" width="46" height="19" rx="4" fill="#244d59"/><text x="${x(uiTime())}" y="20" fill="white" text-anchor="middle" font-size="11">${hh(uiTime())}</text>`;
    $('chart').innerHTML = s;
}
function factorHTML(q) {
    return q.factors.map(f => `<div class="factor-row"><div><span>${f.name}</span><b>${(f.score * f.weight).toFixed(1)} / ${Math.round(f.weight * 100)}</b></div><div class="meter"><i style="width:${f.score}%"></i></div><small>${f.detail}</small></div>`).join('');
}
function render() {
    const p = viewPlan()
      , ev = viewEvents()
      , idx = Rail.quality(p, ev)
      , tt = uiTime();
    $('clock').textContent = hh(tt) + ':' + String(Math.floor(tt * 60) % 60).padStart(2, '0');
    $('active').innerHTML = trains.filter(t => state(t).status === 'В движении').length + ' <small>/ 6</small>';
    $('delay').innerHTML = Math.round(Rail.delay(p)) + ' <small>мин</small>';
    $('quality').innerHTML = idx.total + ' <small>/ 100</small>';
    $('quality').style.color = idx.total >= 80 ? '#168477' : idx.total >= 60 ? '#b38235' : '#c36148';
    $('qualityLabel').textContent = (idx.total >= 80 ? 'Норма' : idx.total >= 60 ? 'Внимание' : 'Критично') + ' · ' + Rail.conflicts(p, ev) + ' нарушений';
    $('play').textContent = running ? 'Ⅱ Пауза' : '▶ Запустить';
    $('play').disabled = !!pending || !link.online || replayIndex !== null;
    $('scrub').max = Math.max(0, history.length - 1);
    $('scrub').value = replayIndex ?? Math.max(0, history.length - 1);
    $('scrub').disabled = history.length < 2;
    $('timeStart').textContent = hh(history[0]?.time ?? time);
    $('timeEnd').textContent = hh(time);
    $('replay').textContent = replayIndex === null ? 'Текущее время' : `История · версия ${history[replayIndex].revision}`;
    $('historyHint').textContent = `Записано ${Math.min(15, time - (history[0]?.time ?? time)).toFixed(1)} мин из 15 · снимки времени и версии плана`;
    map();
    detail();
    chart();
    $('factorPanel').innerHTML = factorHTML(idx);
    $('rows').innerHTML = trains.map(tr => {
        let d = Math.max(0, p[tr.id][3].arr - base[tr.id][3].arr)
          , st = state(tr);
        return `<tr data-row="${tr.id}" class="${selected === tr.id ? 'chosen' : ''}"><td><b style="color:${tr.color}">№ ${tr.id}</b></td><td>${tr.dir === 1 ? 'Астана → Караганда' : 'Караганда → Астана'}</td><td>${hh(p[tr.id][0].dep)}</td><td>${hh(p[tr.id][3].arr)}</td><td style="color:${d ? '#b48035' : '#71929a'}">${d ? '+' + Math.round(d) + ' мин' : 'По плану'}</td><td><span class="pill ${st.speed === 0 ? 'wait' : ''}">${st.status}</span></td></tr>`;
    }
    ).join('');
    document.querySelectorAll('[data-row]').forEach(el => el.onclick = () => pick(el.dataset.row));
    $('log').innerHTML = logs.slice(0, 6).map(l => `<div class="event"><time>${hh(l.at)} · СИМУЛЯТОР</time>${l.text}</div>`).join('');
    updateChannel();
    for (const id of ['incident', 'delayTrain', 'signal', 'burst'])
        $(id).disabled = !!pending || replayIndex !== null || !link.online;
}
function blockEvent(edge, duration, kind) {
    let start = time + 2;
    for (const tr of trains)
        for (const l of plan[tr.id])
            if (l.e === edge && l.dep <= time && l.arr > time)
                start = Math.max(start, l.arr + 2);
    return {
        kind,
        edge,
        start,
        end: start + duration
    };
}
function delayEvent(id, minutes) {
    const j = plan[id].findIndex(l => l.dep > time);
    return j < 0 ? null : {
        kind: 'delay',
        train: id,
        leg: j,
        readyAt: plan[id][j].dep + minutes,
        minutes
    };
}
function scenario(kind) {
    if (pending || replayIndex !== null || !link.online)
        return;
    let additions = [];
    if (kind === 'block')
        additions = [blockEvent(2, 30, 'block')];
    if (kind === 'signal')
        additions = [blockEvent(0, 12, 'signal')];
    if (kind === 'delay') {
        const ev = delayEvent(selected, 10);
        if (!ev) {
            log('Для выбранного поезда нет будущих отправлений. Выберите другой поезд.');
            render();
            return;
        }
        additions = [ev];
    }
    if (kind === 'burst') {
        for (let i = 0; i < 4; i++)
            additions.push(blockEvent(i, 10 + i * 3, i % 2 ? 'signal' : 'block'));
        for (const tr of trains) {
            const ev = delayEvent(tr.id, 10);
            if (ev)
                additions.push(ev);
        }
        if (additions.length < 10) {
            log(`Доступно ${additions.length} событий: часть поездов завершила маршрут.`);
        }
    }
    running = false;
    events = [...events, ...additions];
    const before = performance.now()
      , candidates = [{
        title: 'Пассажирские · экономично',
        strategy: 'passenger',
        mode: 'eco'
    }, {
        title: 'Пассажирские · быстрее',
        strategy: 'passenger',
        mode: 'fast'
    }, {
        title: 'Грузовые · экономично',
        strategy: 'freight',
        mode: 'eco'
    }].map(c => ({
        ...c,
        plan: Rail.schedule({
            events,
            strategy: c.strategy,
            mode: c.mode,
            previous: plan,
            now: time
        })
    }));
    const elapsed = performance.now() - before;
    pending = {
        candidates,
        elapsed
    };
    log(`Получено ${additions.length} событий. Текущие перегоны поездов сохранены, пересчитываются будущие отправления.`);
    record();
    $('alert').hidden = false;
    $('alert').innerHTML = `<strong>Сбой: ${Rail.conflicts(plan, events)} нарушений в исходном плане · ${additions.length} событий</strong><p>Рекомендации рассчитаны за ${elapsed.toFixed(1)} мс. Движение на паузе до выбора. Уже начатые перегоны не меняются; закрытия вводятся после их освобождения.</p><div class="eventlist">${additions.map(ev => ev.edge !== undefined ? `${ev.kind === 'signal' ? 'Сигнал: запрет отправления' : 'Закрытие'} · ${stations[ev.edge]} — ${stations[ev.edge + 1]} · ${hh(ev.start)}–${hh(ev.end)}` : `Задержка № ${ev.train} · +${ev.minutes} мин к следующему отправлению`).join('<br>')}</div><div class="options">${candidates.map( (c, i) => {
        const q = Rail.quality(c.plan, events);
        return `<button class="candidate" data-candidate="${i}"><b>${c.title}</b><span>Индекс ${q.total}/100 · ${q.total - Rail.quality(plan, events).total >= 0 ? '+' : ''}${q.total - Rail.quality(plan, events).total} к текущему</span><span>Задержка ${Math.round(Rail.delay(c.plan))} мин · ${Rail.conflicts(c.plan, events)} нарушений</span><span>Энергия модели ${Math.round(q.energy)} кВт·ч</span><em>Применить рекомендацию</em></button>`;
    }
    ).join('')}</div>`;
    document.querySelectorAll('[data-candidate]').forEach(el => el.onclick = () => applyCandidate(+el.dataset.candidate));
    render();
}
function applyCandidate(i) {
    if (!pending || !pending.candidates[i])
        return;
    const c = pending.candidates[i];
    plan = c.plan;
    planRevision++;
    log(`Применён вариант «${c.title}». Нарушений: ${Rail.conflicts(plan, events)}.`);
    pending = null;
    compare = true;
    record();
    $('tabCompare').classList.add('selected');
    $('tabPlan').classList.remove('selected');
    $('alert').innerHTML = `<strong>План № ${planRevision} применён · ${Rail.conflicts(plan, events)} нарушений ограничений</strong><p>${c.title}. Пунктир — базовый план. Нажмите «Запустить», чтобы продолжить движение.</p>`;
    render();
}
function updateChannel() {
    const now = performance.now()
      , age = (now - link.last) / 1000;
    $('channel').textContent = link.online ? `Симулятор · 1 Гц · пакет ${link.seq}` : `Нет связи · повтор ${link.attempt + 1} через ${Math.max(0, Math.ceil((link.retryAt - now) / 1000))} с`;
    $('channel').classList[link.online ? 'remove' : 'add']('offline');
    $('channelAge').textContent = `Последний пакет ${age.toFixed(0)} с назад`;
    $('disconnect').disabled = !link.online;
}
function disconnect() {
    if (!link.online)
        return;
    const now = performance.now();
    link.online = false;
    link.failUntil = now + 6500;
    link.retryAt = now + 1000;
    link.attempt = 0;
    log('Имитация потери канала. Движение заморожено до восстановления.');
    render();
}
setInterval( () => {
    const now = performance.now();
    if (!link.online && now >= link.retryAt) {
        if (now >= link.failUntil) {
            link.online = true;
            link.last = now;
            log(`Канал симулятора восстановлен после ${link.attempt + 1} попыток.`);
        } else {
            link.attempt++;
            link.retryAt = now + Math.min(4000, 1000 * 2 ** link.attempt);
        }
    }
    if (link.online) {
        link.seq++;
        link.last = now;
    }
    updateChannel();
}
, 1000);
function reset() {
    plan = base;
    time = 10;
    lastRecordTime = time;
    events = [];
    history = [];
    replayIndex = null;
    pending = null;
    running = true;
    planRevision = 1;
    compare = false;
    link = {
        online: true,
        seq: 0,
        last: performance.now(),
        failUntil: 0,
        retryAt: 0,
        attempt: 0
    };
    logs = [{
        at: 10,
        text: 'Новая симуляция с 08:10. История накапливается в этой вкладке.'
    }];
    $('alert').hidden = true;
    $('tabPlan').classList.add('selected');
    $('tabCompare').classList.remove('selected');
    record();
    render();
}
function exportCSV() {
    const p = viewPlan();
    let csv = '\ufeffПоезд;Тип;Вагоны;От станции;До станции;Отправление;Прибытие;Режим;Энергия кВтч\n';
    for (const tr of trains)
        for (const l of p[tr.id])
            csv += [tr.id, tr.type, tr.n, stations[l.from], stations[l.to], hh(l.dep), hh(l.arr), l.mode, Rail.profile(tr, l.mode).energy.toFixed(1)].join(';') + '\n';
    const url = URL.createObjectURL(new Blob([csv],{
        type: 'text/csv;charset=utf-8'
    }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'avtodispatch-schedule.csv';
    a.click();
    setTimeout( () => URL.revokeObjectURL(url), 1000);
    log('CSV текущего отображаемого плана выгружен.');
    render();
}
function printReport() {
    running = false;
    render();
    const q = Rail.quality(viewPlan(), viewEvents());
    $('printReport').innerHTML = `<h1>Автодиспетчер — отчёт симуляции</h1><p>Модельное время ${hh(uiTime())} · ${replayIndex === null ? 'текущий план' : 'исторический снимок'} · синтетические данные</p><p>Индекс ${q.total}/100 · задержка ${Math.round(Rail.delay(viewPlan()))} мин · нарушения ${Rail.conflicts(viewPlan(), viewEvents())} · энергия модели ${Math.round(q.energy)} кВт·ч</p><h2>Пять факторов индекса</h2>${factorHTML(q)}<h2>Расписание</h2><table><thead><tr><th>Поезд</th><th>Маршрут</th><th>Отправление</th><th>Прибытие</th><th>Задержка</th><th>Состояние</th></tr></thead><tbody>${$('rows').innerHTML}</tbody></table><h2>Поездограмма</h2><svg viewBox="0 0 1120 285">${$('chart').innerHTML}</svg><h2>${$('atoTitle').textContent}</h2><p>${$('atoLeg').textContent}</p><svg viewBox="0 0 560 185">${$('atoChart').innerHTML}</svg><p>${$('atoAssumptions').textContent}</p><p>Рекомендации, не команды. Учебная модель с неограниченной вместимостью станций. Не заменяет сертифицированные системы безопасности.</p>`;
    window.print();
}
$('play').onclick = () => {
    running = !running;
    render();
}
;
$('reset').onclick = reset;
$('speed').onchange = e => speed = +e.target.value;
$('incident').onclick = () => scenario('block');
$('delayTrain').onclick = () => scenario('delay');
$('signal').onclick = () => scenario('signal');
$('burst').onclick = () => scenario('burst');
$('disconnect').onclick = disconnect;
$('export').onclick = exportCSV;
$('pdf').onclick = printReport;
$('scrub').oninput = e => {
    running = false;
    replayIndex = Math.max(0, Math.min(history.length - 1, +e.target.value));
    render();
}
;
$('live').onclick = () => {
    replayIndex = null;
    render();
}
;
$('back5').onclick = () => {
    running = false;
    const target = uiTime() - 5;
    replayIndex = history.reduce( (best, h, i) => Math.abs(h.time - target) < Math.abs(history[best].time - target) ? i : best, 0);
    render();
}
;
$('tabPlan').onclick = () => {
    compare = false;
    $('tabPlan').classList.add('selected');
    $('tabCompare').classList.remove('selected');
    chart();
}
;
$('tabCompare').onclick = () => {
    compare = true;
    $('tabCompare').classList.add('selected');
    $('tabPlan').classList.remove('selected');
    chart();
}
;
$('qualityInfo').onclick = () => {
    $('factors').innerHTML = factorHTML(Rail.quality(viewPlan(), viewEvents()));
    $('modal').showModal();
}
;
$('closeModal').onclick = () => $('modal').close();
let previousFrame = performance.now()
  , lastPanelFrame = 0
  , lastRecordTime = time;
function animate(now) {
    const elapsed = Math.min(.1, (now - previousFrame) / 1000);
    previousFrame = now;
    if (running && link.online && replayIndex === null && !pending) {
        time += elapsed * speed / 60;
        moveTrains();
        if (time - lastRecordTime >= .25) {
            record();
            lastRecordTime = time;
        }
        const end = Math.max(...trains.map(t => plan[t.id][3].arr)) + 1;
        if (time >= end) {
            running = false;
            record();
            log('Все поезда завершили маршруты.');
        }
    }
    if (now - lastPanelFrame >= 1000) {
        render();
        lastPanelFrame = now;
    }
    requestAnimationFrame(animate);
}
record();
render();
requestAnimationFrame(animate);
if (document.modelContext?.registerTool) {
    const lifecycle = new AbortController();
    try {
        Promise.resolve(document.modelContext.registerTool({
            name: 'select_train',
            description: 'Выбрать поезд и показать его маршрут, вагоны и профиль скорости',
            inputSchema: {
                type: 'object',
                properties: {
                    train_id: {
                        type: 'string',
                        enum: trains.map(t => t.id)
                    }
                },
                required: ['train_id'],
                additionalProperties: false
            },
            annotations: {
                readOnlyHint: false
            },
            execute(input) {
                if (!input || !trains.some(t => t.id === input.train_id))
                    throw Error('Неизвестный поезд');
                pick(input.train_id);
                return {
                    selected_train: selected,
                    wagons: trains.find(t => t.id === selected).n
                };
            }
        }, {
            signal: lifecycle.signal
        })).catch( () => {}
        );
    } catch {}
    window.addEventListener('pagehide', () => lifecycle.abort(), {
        once: true
    });
}
