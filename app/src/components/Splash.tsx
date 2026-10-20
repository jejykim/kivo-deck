import logo from "../assets/kivo-logo.png";

// Kivo Lab logo fading in on white, like the mamus app. Click to skip.
export function Splash({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="splash" onClick={onSkip}>
      <img src={logo} alt="Kivo Lab" />
    </div>
  );
}
