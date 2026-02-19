import React from "react";

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(22, 16, 14, 0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const cardStyle = {
  width: "min(520px, 92vw)",
  background: "rgba(249, 246, 238, 0.98)",
  border: "1px solid rgba(45, 27, 27, 0.18)",
  borderRadius: 16,
  boxShadow: "0 24px 60px rgba(45, 27, 27, 0.22)",
  padding: "22px 22px 18px",
};

const titleStyle = {
  margin: 0,
  fontFamily: "Playfair Display, serif",
  fontSize: 22,
  color: "#2D1B1B",
};

const bodyStyle = {
  marginTop: 10,
  fontFamily: "Inter, sans-serif",
  fontSize: 14,
  color: "#5E4A3F",
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
};

const actionsStyle = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: 18,
};

const buttonStyle = {
  border: "1px solid #2D1B1B",
  background: "#2D1B1B",
  color: "#FFFBF3",
  padding: "8px 16px",
  borderRadius: 999,
  fontFamily: "Inter, sans-serif",
  fontWeight: 800,
  letterSpacing: "0.08em",
  cursor: "pointer",
};

export default function AlertModal({ open, title = "Notice", message = "", onClose }) {
  if (!open) return null;
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={titleStyle}>{title}</h3>
        <div style={bodyStyle}>{message}</div>
        <div style={actionsStyle}>
          <button style={buttonStyle} onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
