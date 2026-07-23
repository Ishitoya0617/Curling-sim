// ---- physics constants (illustrative, tuned for feel not real ice) ----
const { useRef, useEffect, useState, useCallback } = React;

const R = 19;                 // stone radius (px)
const FRICTION = 42;          // speed loss per second (px/s^2)
const STOP_EPS = 3;           // speed below which a stone is "stopped"
const SUBSTEPS = 6;           // physics substeps per frame (avoid tunneling)

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function CurlingSimulator() {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const stonesRef = useRef([]);
  const runningRef = useRef(false);
  const contactRef = useRef(null); // {x,y} where shooter first touches the opponent stone
  const trailsRef = useRef({});    // id -> [{x,y}, ...] path taken by each stone while moving

  const [offset, setOffset] = useState(0);      // aim offset in px, - left / + right
  const [speed, setSpeed] = useState(260);       // launch speed px/s
  const [phase, setPhase] = useState("aim");      // "aim" | "running" | "done"
  const [result, setResult] = useState(null);
  const [tick, setTick] = useState(0);            // force redraw during aim

  const W = 520, H = 620;
  const center = { x: W / 2, y: H / 2 + 40 };
  const houseR = { outer: 190, red: 100, tee: 14 };

  const initialStones = useCallback(() => {
    return [
      { id: "opp", team: "opp", x: center.x, y: center.y + 18, vx: 0, vy: 0, moving: false, launched: true, trail: [] },
      { id: "you-fixed", team: "you", x: center.x, y: center.y - 18, vx: 0, vy: 0, moving: false, launched: true, trail: [] },
      { id: "you-shot", team: "you", x: center.x + offset, y: H - 40, vx: 0, vy: 0, moving: false, launched: false, trail: [] },
    ];
  }, [offset]);

  useEffect(() => {
    stonesRef.current = initialStones();
    draw();
    // eslint-disable-next-line
  }, [offset]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line
  }, [tick]);

  function throwStone() {
    const s = stonesRef.current.find((s) => s.id === "you-shot");
    if (!s) return;
    s.vx = 0;
    s.vy = -speed;
    s.moving = true;
    s.launched = true;
    setPhase("running");
    runningRef.current = true;
    setResult(null);
    rafRef.current = requestAnimationFrame(loop);
  }

  function reset() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    runningRef.current = false;
    stonesRef.current = initialStones();
    contactRef.current = null;
    trailsRef.current = {};
    setPhase("aim");
    setResult(null);
    setTick((t) => t + 1);
  }

  function loop(tPrev) {
    if (!runningRef.current) return;
    const dt = 1 / 60 / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) step(dt);
    draw();

    const stones = stonesRef.current;
    for (const s of stones) {
      if (s.moving) {
        if (!trailsRef.current[s.id]) trailsRef.current[s.id] = [];
        trailsRef.current[s.id].push({ x: s.x, y: s.y });
      }
    }
    const anyMoving = stones.some((s) => s.moving);
    if (anyMoving) {
      rafRef.current = requestAnimationFrame(loop);
    } else {
      runningRef.current = false;
      setPhase("done");
      computeResult();
    }
  }

  function step(dt) {
    const stones = stonesRef.current;
    // integrate + friction
    for (const s of stones) {
      if (!s.moving) continue;
      const sp = Math.hypot(s.vx, s.vy);
      if (sp <= STOP_EPS) {
        s.vx = 0; s.vy = 0; s.moving = false;
        continue;
      }
      const newSp = Math.max(0, sp - FRICTION * dt);
      const scale = newSp / sp;
      s.vx *= scale; s.vy *= scale;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (newSp <= STOP_EPS) { s.vx = 0; s.vy = 0; s.moving = false; }
    }
    // collisions (equal mass, elastic, e=1): swap normal velocity component
    for (let i = 0; i < stones.length; i++) {
      for (let j = i + 1; j < stones.length; j++) {
        const a = stones[i], b = stones[j];
        const d = dist(a, b);
        if (d < 2 * R && d > 0.0001) {
          const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
          // record first contact point between the shooter and the opponent stone
          const isShooterOppPair =
            (a.id === "you-shot" && b.id === "opp") || (a.id === "opp" && b.id === "you-shot");
          if (isShooterOppPair && !contactRef.current) {
            contactRef.current = { x: a.x + nx * R, y: a.y + ny * R };
          }
          // separate overlap
          const overlap = (2 * R - d) / 2;
          a.x -= nx * overlap; a.y -= ny * overlap;
          b.x += nx * overlap; b.y += ny * overlap;
          const rvx = a.vx - b.vx, rvy = a.vy - b.vy;
          const vn = rvx * nx + rvy * ny;
          if (vn > 0) {
            a.vx -= vn * nx; a.vy -= vn * ny;
            b.vx += vn * nx; b.vy += vn * ny;
            a.moving = Math.hypot(a.vx, a.vy) > STOP_EPS;
            b.moving = Math.hypot(b.vx, b.vy) > STOP_EPS;
          }
        }
      }
    }
  }

  function computeResult() {
    const stones = stonesRef.current;
    const withDist = stones.map((s) => ({
      ...s,
      d: dist(s, center),
      inHouse: dist(s, center) <= houseR.outer + R * 0.3,
    })).filter((s) => s.inHouse);
    withDist.sort((a, b) => a.d - b.d);
    if (withDist.length === 0) {
      setResult({ text: "ハウスの中に石が残りませんでした。0-0（無得点）", winning: null });
      return;
    }
    const closestTeam = withDist[0].team;
    let count = 0;
    for (const s of withDist) {
      if (s.team === closestTeam) count++;
      else break;
    }
    const teamLabel = closestTeam === "you" ? "あなた" : "敵";
    setResult({
      text: `${teamLabel} が ${count} 点獲得`,
      winning: closestTeam,
      count,
    });
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    // ice background
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#eef6fb");
    grad.addColorStop(1, "#dbeaf3");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // house rings
    const rings = [
      { r: houseR.outer, color: "#1f6fb2" },
      { r: houseR.outer - 45, color: "#f7fbfd" },
      { r: houseR.red, color: "#c23b3b" },
      { r: houseR.red - 45, color: "#f7fbfd" },
      { r: houseR.tee, color: "#c23b3b" },
    ];
    for (const ring of rings) {
      ctx.beginPath();
      ctx.arc(center.x, center.y, ring.r, 0, Math.PI * 2);
      ctx.fillStyle = ring.color;
      ctx.fill();
    }
    // crosshair lines
    ctx.strokeStyle = "rgba(60,60,60,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y - houseR.outer);
    ctx.lineTo(center.x, center.y + houseR.outer);
    ctx.moveTo(center.x - houseR.outer, center.y);
    ctx.lineTo(center.x + houseR.outer, center.y);
    ctx.stroke();

    // aim guide line (only while aiming)
    if (phase === "aim") {
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = "rgba(30,30,30,0.5)";
      ctx.beginPath();
      ctx.moveTo(center.x + offset, H - 40);
      ctx.lineTo(center.x + offset, 0);
      ctx.stroke();
      ctx.restore();
    }

    // trails: faint dashed light-blue path for each stone that has moved
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = "rgba(80, 190, 230, 0.6)";
    ctx.lineWidth = 2;
    for (const id in trailsRef.current) {
      const pts = trailsRef.current[id];
      if (!pts || pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    ctx.restore();

    // stones
    for (const s of stonesRef.current) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, R, 0, Math.PI * 2);
      ctx.fillStyle = s.team === "you" ? "#b8324a" : "#e3b23c";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = s.team === "you" ? "#7a1d2c" : "#a9821f";
      ctx.stroke();
      // handle marker
      ctx.beginPath();
      ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fill();
    }

    // contact point where the shooter first touched the opponent stone
    if (contactRef.current) {
      const { x, y } = contactRef.current;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ff0000";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }

    // throw direction arrow
    ctx.save();
    ctx.strokeStyle = "#274b63";
    ctx.fillStyle = "#274b63";
    ctx.lineWidth = 3;
    const ax = center.x + offset, ay1 = H - 15, ay2 = H - 70;
    ctx.beginPath();
    ctx.moveTo(ax, ay1);
    ctx.lineTo(ax, ay2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax - 6, ay2 + 10);
    ctx.lineTo(ax + 6, ay2 + 10);
    ctx.lineTo(ax, ay2 - 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      fontFamily: "'Hiragino Sans', 'Yu Gothic', sans-serif",
      background: "#0f2b3d", padding: "16px 12px", minHeight: "100%",
      boxSizing: "border-box", width: "100%",
    }}>
      <h2 style={{
        color: "#eef6fb", margin: "0 0 4px", fontWeight: 700, letterSpacing: 1,
        fontSize: "clamp(16px, 5vw, 22px)", textAlign: "center",
      }}>
        カーリング最終投 シミュレーター
      </h2>
      <p style={{
        color: "#9fc3d6", margin: "0 0 14px", fontSize: "clamp(11px, 3.2vw, 14px)",
        textAlign: "center", maxWidth: 480,
      }}>
        赤 = あなた（後攻）／ 黄 = 敵。狙いのズレと速さを調整して、敵石(黄)だけを弾き出せるか試そう。
      </p>

      <div style={{
        background: "#0b2130", borderRadius: 12, padding: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)", width: "100%",
        maxWidth: W, boxSizing: "border-box",
      }}>
        <canvas
          ref={canvasRef} width={W} height={H}
          style={{ borderRadius: 8, display: "block", width: "100%", height: "auto" }}
        />
      </div>

      <div style={{ width: "100%", maxWidth: W, marginTop: 16, color: "#eef6fb", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
          <span>狙いのズレ（中心から左右）</span>
          <span>{offset > 0 ? "+" : ""}{offset}px</span>
        </div>
        <input
          type="range" min={-38} max={38} step={1} value={offset}
          disabled={phase !== "aim"}
          onChange={(e) => setOffset(parseInt(e.target.value))}
          style={{ width: "100%" }}
        />

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 12, marginBottom: 4 }}>
          <span>初速（ウェイト）</span>
          <span>{speed}px/s</span>
        </div>
        <input
          type="range" min={150} max={420} step={5} value={speed}
          disabled={phase !== "aim"}
          onChange={(e) => setSpeed(parseInt(e.target.value))}
          style={{ width: "100%" }}
        />

        <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            onClick={throwStone}
            disabled={phase !== "aim"}
            style={{
              flex: "1 1 140px", padding: "12px 20px", borderRadius: 8, border: "none",
              background: phase === "aim" ? "#b8324a" : "#5c5c5c",
              color: "#fff", fontWeight: 700, cursor: phase === "aim" ? "pointer" : "default",
              fontSize: 15, minHeight: 44,
            }}
          >
            投げる
          </button>
          <button
            onClick={reset}
            style={{
              flex: "1 1 140px", padding: "12px 20px", borderRadius: 8, border: "1px solid #6a90a8",
              background: "transparent", color: "#eef6fb", fontWeight: 600, cursor: "pointer", fontSize: 15,
              minHeight: 44,
            }}
          >
            リセット
          </button>
        </div>

        {result && (
          <div style={{
            marginTop: 16, padding: "12px 16px", borderRadius: 8,
            background: result.winning === "you" ? "#1e4d2b" : result.winning === "opp" ? "#5a2323" : "#3a3a3a",
            textAlign: "center", fontSize: 16, fontWeight: 700,
          }}>
            {result.text}
          </div>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<CurlingSimulator />);
