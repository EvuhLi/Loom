import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import loom_about_me from "./assets/loom_about_me.jpg";
import weaving_loom from "./assets/weaving_loom.jpg";
import distorted_art from "./assets/distorted_art.jpg";
import collage from "./assets/collage.jpg";
import cfa from "./assets/cfa.jpg";

/* ------------------ AESTHETIC COMPONENTS ------------------ */

const WashiTape = ({ color, style }) => (
  <div style={{
    width: 130, height: 35, backgroundColor: color || "rgba(220,220,220,0.8)",
    position: "absolute", opacity: 0.9, zIndex: 50,
    clipPath: "polygon(0% 5%, 5% 0%, 15% 5%, 25% 0%, 35% 5%, 45% 0%, 55% 5%, 65% 0%, 75% 5%, 85% 0%, 95% 5%, 100% 0%, 100% 95%, 95% 100%, 85% 95%, 75% 100%, 65% 95%, 55% 100%, 45% 95%, 35% 100%, 25% 95%, 15% 100%, 5% 95%, 0% 100%)",
    boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
    ...style
  }} />
);

const PaperClip = ({ style }) => (
  <svg width="30" height="70" viewBox="0 0 30 70" style={{ position: "absolute", zIndex: 60, ...style }}>
    <path d="M 10 60 V 20 A 10 10 0 0 1 30 20 V 60" fill="none" stroke="#999" strokeWidth="4" />
    <path d="M 5 60 V 20 A 15 15 0 0 1 35 20 V 60" fill="none" stroke="#888" strokeWidth="4" />
    <rect x="0" y="50" width="15" height="20" fill="rgba(255,255,255,0.5)" /> 
  </svg>
);

const Pin = ({ style }) => (
  <div style={{
    width: 18, height: 18, borderRadius: "50%", background: "#444",
    boxShadow: "inset -2px -2px 5px rgba(255,255,255,0.3), 3px 5px 5px rgba(0,0,0,0.3)",
    position: "absolute", zIndex: 60, ...style
  }} />
);

const ScribbleUnderline = ({ color }) => (
  <svg width="100%" height="15" viewBox="0 0 200 15" style={{ display: 'block', marginTop: 10, opacity: 0.8, overflow: 'visible' }}>
    <path d="M5 10 Q 50 15, 100 5 T 195 10" fill="none" stroke={color || "#333"} strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const Sparkle = ({ style }) => (
  <div style={{ fontSize: "30px", position: "absolute", zIndex: 20, ...style }}>✨</div>
);

/* ------------------ MAIN PAGE COMPONENT ------------------ */

export default function AboutZineScrollPage() {
  const slides = useMemo(
    () => [
      {
        layout: "bg",
        kicker: "ABOUT LOOM",
        title: "Mission",
        body: "LOOM is a platform that protects human-made artwork in an age where AI-generated and AI-scraped content is rapidly flooding creative spaces.",
        bgImage: loom_about_me,
        tag: "Mission",
        accent: "sage",
      },
      {
        layout: "split",
        kicker: "THE PROBLEM",
        title: "The Reality",
        body: "Generative AI models are increasingly being trained on large-scale scraped art datasets, often without artists’ consent, attribution, or compensation. This raises various ethical concerns, including loss of ownership, dataset bias, theft of creative labor, and difficulty distinguishing AI-generated art from human work.",
        bgImage: distorted_art,
        tag: "Issues",
        accent: "clay",
      },
      {
        layout: "bg",
        kicker: "OUR NAME",
        title: "Origins",
        body: "The name LOOM was inspired by the weaving power looms of the Industrial Revolution. This invention changed artistic production forever. We embody this intersection: using technology to protect artistic work.",
        tag: "Name",
        accent: "slate",
        bgImage: weaving_loom,
      },
      {
        layout: "collage",
        kicker: "ABOUT US",
        title: "The Team",
        body: "We are four students at Carnegie Mellon University — Jenny, Arlene, Shreya, and Eva — building an artist-centered space where original work can be created and shared among users without AI infiltration. As students studying Information Systems, Statistics, and Machine Learning, we are increasingly aware of the risks of generative AI, and thus propose a solution of community-centered sharing. LOOM is our attempt to build a safer place for creators, protecting human creativity from AI exploitation. ",
        imageA: cfa,
        imageB: collage,
        tag: "Creators",
        accent: "cream",
      },
    ],
    []
  );

  const scrollerRef = useRef(null);
  const sectionRefs = useRef([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        let best = null;
        for (const e of entries) {
          if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
        }
        if (best && best.isIntersecting) {
          const idx = Number(best.target.getAttribute("data-idx"));
          if (!Number.isNaN(idx)) setActive(idx);
        }
      },
      { root, threshold: [0.35, 0.5, 0.65, 0.8, 0.95] }
    );
    sectionRefs.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const jumpTo = (idx) => {
    const el = sectionRefs.current[idx];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const palette = palettes[slides[active]?.accent] || palettes.sage;

  return (
    <div style={page}>
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Lato:wght@300;400;700&display=swap');
        `}
      </style>

      <TopNav />

      <div ref={scrollerRef} style={scroller}>
        {slides.map((s, idx) => {
          const pal = palettes[s.accent] || palettes.sage;
          const isActive = idx === active;
          return (
            <section
              key={idx}
              data-idx={idx}
              ref={(el) => (sectionRefs.current[idx] = el)}
              style={{ ...section, background: "transparent" }}
            >
              <div style={contentWrap}>
                <Slide s={s} palette={pal} active={isActive} />
              </div>
            </section>
          );
        })}
      </div>

      <div style={{ ...hintBar, borderColor: palette.line }}>
        Scroll <span style={scrollIcon}>⌄</span>
      </div>

      <div style={{ ...miniProgress, borderColor: palette.line }}>
        <span style={{ fontWeight: 900 }}>{slides[active]?.tag}</span>
        <span style={{ opacity: 0.7, marginLeft: 10 }}>
          {active + 1} / {slides.length}
        </span>
      </div>

      <Dots total={slides.length} active={active} onJump={jumpTo} palette={palette} />
    </div>
  );
}

/* ------------------ SLIDE LAYOUTS ------------------ */

function Slide({ s, palette, active }) {
  if (s.layout === "bg") return <SlideBG s={s} palette={palette} active={active} />;
  if (s.layout === "collage") return <SlideCollage s={s} palette={palette} active={active} />;
  return <SlideSplit s={s} palette={palette} active={active} />;
}

function AnimateBox({ active, style, children }) {
  return (
    <div
      style={{
        ...style,
        opacity: active ? 1 : 0,
        transform: active ? "translateY(0px)" : "translateY(28px)",
        filter: active ? "blur(0px)" : "blur(6px)",
        transition: "opacity 800ms ease, transform 800ms ease, filter 800ms ease",
      }}
    >
      {children}
    </div>
  );
}

function SlideSplit({ s, palette, active }) {
  return (
    <div style={splitGrid}>
      <AnimateBox active={active} style={{ ...textCard, borderColor: palette.line }}>
        <WashiTape color={palette.tape} style={{ top: -15, left: "30%" }} />
        <Pin style={{ top: 10, right: 10 }} />
        
        <div style={{ ...kicker, color: palette.kicker }}>{s.kicker}</div>
        <div style={{ ...title, color: palette.title }}>{s.title}</div>
        <div style={{ ...body, color: palette.body }}>{s.body}</div>
        <ScribbleUnderline color={palette.kicker} />
      </AnimateBox>

      <AnimateBox active={active} style={rightCol}>
        <div style={{ ...imageFrame, borderColor: palette.line, transform: "rotate(3deg)" }}>
          <div style={imageInner}>
             <div style={{ ...image, backgroundImage: `url(${s.bgImage})` }} />
          </div>
          <div style={{ position: "absolute", top: 20, left: -10, width: 30, height: 60, border: "4px solid #ddd", borderRadius: 20, borderRight: "none", zIndex: 100 }}></div>
        </div>
      </AnimateBox>
    </div>
  );
}

function SlideBG({ s, palette, active }) {
  return (
    <div style={oneFrame}>
      <div style={{ ...bgFull, backgroundImage: `url(${s.bgImage})` }}>
        <div style={{ ...bgTint, background: palette.bgTint }} />
        <div style={bgVignette} />
      </div>

      <AnimateBox
        active={active}
        style={{
          ...floatCard,
          background: "#F9F7F1",
          border: "none",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
      >
        <Pin style={{ top: -10, left: "50%", transform: "translateX(-50%)" }} />
        <WashiTape color={palette.tape} style={{ bottom: -15, right: -10, transform: "rotate(-10deg)" }} />
        
        <div style={{ ...kicker, color: "#555" }}>{s.kicker}</div>
        <div style={{ ...title, color: "#222" }}>{s.title || s.tag}</div>
        <div style={{ ...body, color: "#444" }}>{s.body}</div>
      </AnimateBox>
    </div>
  );
}

function SlideCollage({ s, palette, active }) {
  return (
    <div style={oneFrame}>
      <AnimateBox active={active} style={collageWrap}>
        {/* Adjusted left and top positions to push images left and up */}
        <div style={{ ...panel, ...panelA, background: "#fff", padding: 12 }}>
          <div style={{ ...panelImg, backgroundImage: `url(${s.imageA})` }} />
          <WashiTape color="rgba(255,255,255,0.6)" style={{ top: -15, left: "40%" }} />
        </div>
        
        <div style={{ ...panel, ...panelB, background: "#fff", padding: 12 }}>
          <div style={{ ...panelImg, backgroundImage: `url(${s.imageB})` }} />
          <Sparkle style={{ top: -20, right: -20 }} />
        </div>
      </AnimateBox>

      {/* Adjusted positioning: Moved to the right, lowered bottom slightly, and increased zIndex to ensure it sits on top if needed, though pushing panels left fixes the main issue. */}
      <AnimateBox active={active} style={{ ...floatCard, right: "10%", left: "auto", bottom: "10%", zIndex: 20, maxWidth: 500 }}>
        <Pin style={{ top: 10, left: 10 }} />
        <div style={{ ...kicker, color: palette.kicker }}>{s.kicker}</div>
        <div style={{ ...title, color: palette.title }}>{s.title}</div>
        <div style={{ ...body, color: palette.body }}>{s.body}</div>
      </AnimateBox>
    </div>
  );
}

/* ------------------ NAV + DOTS ------------------ */

function TopNav() {
  return (
    <div style={nav}>
      <div style={navLeft}>
        <Link to="/" style={navLink}>HOME</Link>
        <Link to="/collection" style={navLink}>COLLECTION</Link>
      </div>
      <div style={brand}>loom</div>
      <div style={navRight}>
        <Link to="/about" style={{ ...navLink, opacity: 1, borderBottom: "1px solid #333" }}>ABOUT</Link>
        <Link to="/login" style={navLink}>LOGIN</Link>
      </div>
    </div>
  );
}

function Dots({ total, active, onJump, palette }) {
  return (
    <div style={{ ...dotsWrap, borderColor: palette.line }}>
      {Array.from({ length: total }).map((_, idx) => (
        <button
          key={idx}
          onClick={() => onJump(idx)}
          style={{
            ...dot,
            background: palette.dot,
            opacity: idx === active ? 1 : 0.35,
            transform: idx === active ? "scale(1.25)" : "scale(1)",
          }}
          aria-label={`Go to slide ${idx + 1}`}
        />
      ))}
    </div>
  );
}

/* ------------------ PALETTES ------------------ */

const palettes = {
  sage: {
    bg: "transparent", title: "#2C3E2D", body: "#4A4A4A", kicker: "#5D6E5E",
    line: "rgba(0,0,0,0.1)", bgTint: "rgba(44, 62, 45, 0.3)",
    tape: "rgba(165, 165, 141, 0.6)", dot: "#2C3E2D",
  },
  clay: {
    bg: "transparent", title: "#5C4033", body: "#4A3B32", kicker: "#8D6E63",
    line: "rgba(0,0,0,0.1)", bgTint: "rgba(92, 64, 51, 0.3)",
    tape: "rgba(165, 165, 141, 0.6)", dot: "#5C4033",
  },
  slate: {
    bg: "transparent", title: "#2C3E50", body: "#34495E", kicker: "#5D6D7E",
    line: "rgba(0,0,0,0.1)", bgTint: "rgba(44, 62, 80, 0.3)",
    tape: "rgba(200, 200, 200, 0.5)", dot: "#2C3E50",
  },
  cream: {
    bg: "transparent", title: "#3E2723", body: "#5D4037", kicker: "#8D6E63",
    line: "rgba(0,0,0,0.1)", bgTint: "rgba(62, 39, 35, 0.2)",
    tape: "rgba(220, 200, 180, 0.6)", dot: "#3E2723",
  },
};

/* ------------------ STYLES ------------------ */

const page = {
  height: "100vh",
  overflow: "hidden",
  position: "relative",
  backgroundColor: "#FDFBF7",
  backgroundImage: `linear-gradient(#E8E4D9 1px, transparent 1px), linear-gradient(90deg, #E8E4D9 1px, transparent 1px)`,
  backgroundSize: "40px 40px",
  fontFamily: "'Lato', sans-serif",
  color: "#4A4A4A",
};

const scroller = {
  height: "100vh",
  overflowY: "auto",
  scrollSnapType: "y mandatory",
  scrollBehavior: "smooth",
};

const section = {
  height: "100vh",
  scrollSnapAlign: "start",
  position: "relative",
  overflow: "hidden",
};

const contentWrap = {
  height: "100%", padding: "90px 40px 40px", position: "relative", zIndex: 2,
  display: "flex", flexDirection: "column", justifyContent: "center"
};

const splitGrid = {
  height: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40,
  alignItems: "center", maxWidth: 1200, margin: "0 auto"
};

const oneFrame = { height: "100%", position: "relative", width: "100%" };

const textCard = {
  maxWidth: 600, padding: "40px", background: "#fff",
  boxShadow: "0 10px 30px rgba(0,0,0,0.08)", position: "relative",
  transform: "rotate(-1deg)", overflow: "visible", borderRadius: 2
};

const floatCard = {
  position: "absolute", left: 60, bottom: 100, maxWidth: 600, padding: "40px",
  background: "#fff", boxShadow: "0 15px 40px rgba(0,0,0,0.15)",
  transform: "rotate(1deg)", zIndex: 10, overflow: "visible", borderRadius: 2
};

const kicker = { fontFamily: "'Caveat', cursive", fontSize: 24, letterSpacing: 1, marginBottom: 8, fontWeight: 700 };
const title = { fontFamily: "'Playfair Display', serif", fontSize: "clamp(36px, 4vw, 64px)", lineHeight: 1.1, marginBottom: 20, fontWeight: 700 };
const body = { fontFamily: "'Lato', sans-serif", fontSize: 18, lineHeight: 1.6 };

const rightCol = { display: "flex", justifyContent: "center", alignItems: "center" };

const imageFrame = {
  width: "min(500px, 40vw)", height: "min(600px, 60vh)", background: "#fff",
  padding: "15px 15px 60px 15px", boxShadow: "0 20px 50px rgba(0,0,0,0.15)",
  position: "relative", overflow: "visible" 
};
const imageInner = { width: "100%", height: "100%", overflow: "hidden" };
const image = { width: "100%", height: "100%", backgroundSize: "cover", backgroundPosition: "center", filter: "sepia(15%) contrast(1.05)" };

const bgFull = { position: "absolute", inset: 0, backgroundSize: "cover", backgroundPosition: "center" };
const bgTint = { position: "absolute", inset: 0 };
const bgVignette = { position: "absolute", inset: 0, background: "radial-gradient(circle, transparent 20%, rgba(0,0,0,0.4) 90%)" };

const collageWrap = { position: "absolute", inset: 0 };
const panel = { position: "absolute", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", overflow: "visible" };
const panelImg = { position: "absolute", inset: 10, backgroundSize: "cover", backgroundPosition: "center", filter: "sepia(20%)" };

// --- ADJUSTED COLLAGE IMAGES (Pushed Left) ---
const panelA = { width: "35vw", height: "45vh", left: "5%", top: "15%", transform: "rotate(-4deg)" };
const panelB = { width: "30vw", height: "40vh", left: "25%", top: "35%", transform: "rotate(5deg)" };

const nav = {
  position: "fixed", top: 0, left: 0, right: 0, height: 80, display: "flex", alignItems: "center",
  justifyContent: "space-between", padding: "0 40px", zIndex: 100,
  background: "rgba(253, 251, 247, 0.95)", backdropFilter: "blur(5px)", borderBottom: "1px solid rgba(0,0,0,0.05)",
};
const navLeft = { display: "flex", gap: 30, alignItems: "center" };
const navRight = { display: "flex", gap: 30, alignItems: "center" };
const navLink = { textDecoration: "none", color: "#333", fontSize: 13, letterSpacing: 1.5, fontWeight: 700, fontFamily: "'Lato', sans-serif" };
const brand = { fontSize: 24, letterSpacing: 2, fontWeight: 900, fontFamily: "'Playfair Display', serif", textTransform: "lowercase", color: "#111" };

const hintBar = { position: "fixed", left: 30, bottom: 30, zIndex: 90, fontSize: 12, letterSpacing: 1, color: "#333", padding: "8px 16px", background: "#fff", borderRadius: 20, boxShadow: "0 5px 15px rgba(0,0,0,0.1)", fontFamily: "'Lato', sans-serif" };
const scrollIcon = { marginLeft: 8, fontWeight: 900 };
const miniProgress = { position: "fixed", left: 30, top: 100, zIndex: 90, fontSize: 12, letterSpacing: 1, color: "#333", padding: "8px 16px", background: "#fff", borderRadius: 20, boxShadow: "0 5px 15px rgba(0,0,0,0.1)", fontFamily: "'Lato', sans-serif" };
const dotsWrap = { position: "fixed", bottom: 30, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 12, zIndex: 90, padding: "10px 20px", background: "#fff", borderRadius: 20, boxShadow: "0 5px 15px rgba(0,0,0,0.1)" };
const dot = { width: 10, height: 10, borderRadius: "50%", border: "none", cursor: "pointer", transition: "all 0.3s ease" };