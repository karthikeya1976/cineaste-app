"use client";

// Shared circular-initial avatar — issue #17 / U8 (seamless chat plan, KTD7).
//
// Extraction of the identical inline pattern that already exists in six
// places across this frontend (messages/page.tsx's 44px search-result rows,
// MessageToast.tsx's 36px toast avatar, profile/page.tsx's 48px self-avatar,
// feed/page.tsx's 32px comment/creator avatars, search/page.tsx's 44px rows,
// creators/[id]/page.tsx's profile avatar) at different sizes. This
// component is the single new call-site target for the conversation list
// and message-thread avatars (KTD7's two new sites) plus MessageToast.tsx's
// migration (KTD7's "migrate at least the closest existing precedent"
// decision) — the other five pre-existing inline copies are explicitly out
// of scope for this unit and are left untouched.
//
// Style values are copied byte-for-byte from those inline copies, not
// reinvented: borderRadius "50%", background "var(--accent)", color "#fff",
// fontWeight 700, flex-centered, flexShrink 0. fontSize scales at roughly
// size * 0.4 (the issue's own wording) — checked against the four existing
// concrete size/fontSize pairs already in the codebase: 44px->18px,
// 36px->15px, 48px->20px, 32px->13px. Those four ratios cluster at 5/12
// (~0.4167), not exactly 0.4, and size * 5/12 (rounded to the nearest pixel)
// reproduces all four existing values exactly, so that's the multiplier
// used here rather than a flat 0.4 that would drift off 36px->15 and
// 48px->20 by a pixel.
export function initialFor(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

interface AvatarProps {
  name: string;
  size: number;
}

export function Avatar({ name, size }: AvatarProps) {
  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "50%",
        flexShrink: 0,
        background: "var(--accent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: `${Math.round((size * 5) / 12)}px`,
        fontWeight: 700,
        color: "#fff",
      }}
    >
      {initialFor(name)}
    </div>
  );
}
