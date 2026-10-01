'use strict';
const Rail = ( () => {
    const stations = ['Астана', 'Лесная', 'Узловая', 'Озёрная', 'Караганда']
      , km = [0, 52, 104, 156, 210];
    const trains = [{
        id: '001',
        type: 'Скоростной',
        dir: 1,
        start: 2,
        speed: 120,
        n: 10,
        mass: 650,
        color: '#138f86',
        priority: 0
    }, {
        id: '043',
        type: 'Пассажирский',
        dir: -1,
        start: 5,
        speed: 90,
        n: 16,
        mass: 1000,
        color: '#5484e3',
        priority: 1
    }, {
        id: '2104',
        type: 'Грузовой',
        dir: 1,
        start: 9,
        speed: 60,
        n: 48,
        mass: 4500,
        color: '#ba8b48',
        priority: 2
    }, {
        id: '006',
        type: 'Скоростной',
        dir: -1,
        start: 26,
        speed: 120,
        n: 12,
        mass: 770,
        color: '#138f86',
        priority: 0
    }, {
        id: '086',
        type: 'Пассажирский',
        dir: 1,
        start: 33,
        speed: 90,
        n: 18,
        mass: 1120,
        color: '#5484e3',
        priority: 1
    }, {
        id: '3207',
        type: 'Грузовой',
        dir: -1,
        start: 42,
        speed: 60,
        n: 52,
        mass: 4850,
        color: '#ba8b48',
        priority: 2
    }];
    const clamp = (x, a=0, b=100) => Math.max(a, Math.min(b, x))
      , cache = new Map();
    function profile(tr, mode='eco') {
        const key = tr.id + mode;
        if (cache.has(key))
            return cache.get(key);
        const d = 45000
          , a = tr.priority === 2 ? .2 : .35
          , b = tr.priority === 2 ? .3 : .45
          , vmax = tr.speed / 3.6;
        const duration = v => d / v + v / (2 * a) + v / (2 * b)
          , fast = duration(vmax)
          , budget = fast * 1.12;
        let lo = vmax * .5
          , hi = vmax;
        if (mode === 'eco')
            for (let i = 0; i < 50; i++) {
                const v = (lo + hi) / 2;
                if (duration(v) > budget)
                    lo = v;
                else
                    hi = v;
            }
        const v = mode === 'eco' ? hi : vmax
          , ta = v / a
          , tb = v / b
          , da = v * v / (2 * a)
          , db = v * v / (2 * b)
          , dc = d - da - db
          , tc = dc / v;
        // Level track, no wind, no regeneration: positive kinetic + rolling + aerodynamic work / efficiency.
        const mass = tr.mass * 1000
          , rolling = .002 * mass * 9.81 * d
          , drag = .5 * 1.225 * 8 * (v * v * dc + v ** 4 / (4 * a) + v ** 4 / (4 * b));
        const energy = (.5 * mass * v * v + rolling + drag) / (.88 * 3.6e6);
        const p = {
            mode,
            v,
            a,
            b,
            ta,
            tb,
            tc,
            da,
            db,
            dc,
            duration: ta + tc + tb,
            energy,
            d
        };
        cache.set(key, p);
        return p;
    }
    function motion(p, t) {
        t = clamp(t, 0, p.duration);
        if (t < p.ta)
            return {
                d: .5 * p.a * t * t,
                v: p.a * t,
                phase: 'Разгон'
            };
        if (t < p.ta + p.tc)
            return {
                d: p.da + p.v * (t - p.ta),
                v: p.v,
                phase: 'Крейсерский ход'
            };
        const z = t - p.ta - p.tc;
        return {
            d: Math.min(p.d, p.da + p.dc + p.v * z - .5 * p.b * z * z),
            v: Math.max(0, p.v - p.b * z),
            phase: t >= p.duration ? 'Остановка' : 'Торможение'
        };
    }
    function schedule({events=[], strategy='passenger', mode='eco', previous=null, now=0}={}) {
        const busy = Array.from({
            length: 4
        }, () => [])
          , out = {};
        for (const ev of events)
            if (ev.edge !== undefined)
                busy[ev.edge].push([ev.start, ev.end]);
        for (const tr of trains) {
            out[tr.id] = previous ? previous[tr.id].filter(l => l.dep <= now).map(l => ({
                ...l
            })) : [];
            for (const l of out[tr.id])
                busy[l.e].push([l.dep, l.arr]);
        }
        const order = [...trains].sort( (a, b) => (strategy === 'freight' ? b.priority - a.priority : a.priority - b.priority) || a.start - b.start);
        for (const tr of order) {
            const legs = out[tr.id]
              , frozen = legs.length;
            let station = frozen ? legs[frozen - 1].to : tr.dir === 1 ? 0 : 4
              , t = frozen ? Math.max(now, legs[frozen - 1].arr + 2) : Math.max(now, tr.start);
            const pr = profile(tr, mode)
              , duration = pr.duration / 60;
            for (let j = frozen; j < 4; j++) {
                const next = station + tr.dir
                  , edge = Math.min(station, next);
                for (const ev of events)
                    if (ev.train === tr.id && ev.leg === j)
                        t = Math.max(t, ev.readyAt);
                let depart = t;
                for (let tries = 0; tries < 1000; tries++) {
                    const hit = busy[edge].find( ([a,b]) => depart < b + 2 - 1e-8 && depart + duration + 2 > a + 1e-8);
                    if (!hit)
                        break;
                    depart = hit[1] + 2;
                    if (tries === 999)
                        throw Error('Не удалось построить план');
                }
                const l = {
                    from: station,
                    to: next,
                    dep: depart,
                    arr: depart + duration,
                    e: edge,
                    mode
                };
                legs.push(l);
                busy[edge].push([l.dep, l.arr]);
                t = l.arr + 2;
                station = next;
            }
        }
        return out;
    }
    const base = schedule();
    function state(tr, t, p=base) {
        let pos = tr.dir === 1 ? 0 : 4;
        for (let j = 0; j < 4; j++) {
            const l = p[tr.id][j];
            if (t < l.dep)
                return {
                    pos,
                    speed: 0,
                    status: t < tr.start ? 'Ожидает' : 'Стоянка',
                    next: l.to,
                    leg: j,
                    phase: 'Ожидание'
                };
            if (t < l.arr) {
                const m = motion(profile(tr, l.mode), (t - l.dep) * 60);
                return {
                    pos: l.from + tr.dir * m.d / 45000,
                    speed: m.v * 3.6,
                    status: 'В движении',
                    next: l.to,
                    leg: j,
                    phase: m.phase
                };
            }
            pos = l.to;
        }
        return {
            pos,
            speed: 0,
            status: 'Прибыл',
            next: pos,
            leg: 3,
            phase: 'Маршрут завершён'
        };
    }
    function delay(p) {
        return trains.reduce( (s, tr) => s + Math.max(0, p[tr.id][3].arr - base[tr.id][3].arr), 0);
    }
    function conflicts(p, events=[]) {
        let n = 0;
        for (let a = 0; a < trains.length; a++)
            for (let b = a + 1; b < trains.length; b++)
                for (const x of p[trains[a].id])
                    for (const y of p[trains[b].id])
                        if (x.e === y.e && x.dep < y.arr + 2 - 1e-8 && y.dep < x.arr + 2 - 1e-8)
                            n++;
        for (const ev of events) {
            if (ev.edge !== undefined) {
                for (const tr of trains)
                    for (const l of p[tr.id])
                        if (l.e === ev.edge && l.dep < ev.end + 2 - 1e-8 && l.arr + 2 > ev.start + 1e-8)
                            n++;
            } else if (ev.train && p[ev.train][ev.leg].dep < ev.readyAt - 1e-8)
                n++;
        }
        return n;
    }
    function energy(p) {
        return trains.reduce( (s, tr) => s + p[tr.id].reduce( (a, l) => a + profile(tr, l.mode).energy, 0), 0);
    }
    const baseEnd = Math.max(...trains.map(tr => base[tr.id][3].arr))
      , fastEnergy = trains.reduce( (s, tr) => s + 4 * profile(tr, 'fast').energy, 0);
    function quality(p, events=[]) {
        const legs = trains.flatMap(tr => p[tr.id].map( (l, i) => Math.max(0, l.dep - base[tr.id][i].dep)))
          , onTime = 100 * legs.filter(d => d <= 5).length / legs.length
          , end = Math.max(...trains.map(tr => p[tr.id][3].arr))
          , capacity = clamp(100 * baseEnd / end)
          , e = energy(p)
          , saving = 100 * (1 - e / fastEnergy)
          , eff = clamp(80 + saving)
          , safe = clamp(100 - conflicts(p, events) * 25)
          , mae = trains.reduce( (s, tr) => s + Math.abs(p[tr.id][3].arr - base[tr.id][3].arr), 0) / trains.length
          , arrival = clamp(100 - 2 * mae);
        const factors = [{
            name: 'Соблюдение расписания',
            score: onTime,
            weight: .25,
            detail: 'Доля отправлений с опозданием не более 5 мин'
        }, {
            name: 'Пропускная способность',
            score: capacity,
            weight: .2,
            detail: '100 × исходное / новое время завершения всех рейсов; предел 100'
        }, {
            name: 'Энергоэффективность',
            score: eff,
            weight: .2,
            detail: '80 + экономия энергии в % против быстрого профиля; предел 100'
        }, {
            name: 'Бесконфликтность',
            score: safe,
            weight: .2,
            detail: '100 − 25 × число нарушений ограничений'
        }, {
            name: 'Точность прибытия',
            score: arrival,
            weight: .15,
            detail: '100 − 2 × средняя абсолютная ошибка прибытия, мин'
        }];
        return {
            total: Math.round(factors.reduce( (s, f) => s + f.score * f.weight, 0)),
            factors,
            energy: e,
            saving,
            mae
        };
    }
    return {
        stations,
        km,
        trains,
        profile,
        motion,
        schedule,
        state,
        base,
        delay,
        conflicts,
        energy,
        quality,
        baseEnd
    };
}
)();
