// /messages is no longer a page of its own — it's a stable entry point
// (old links, bookmarks, the nav bar's default fallback) that always lands
// on the conversations list, the canonical landing page for the messenger
// surface (nav restructure, KTD1). The compose/search flow that used to
// live at this exact path moved to /messages/compose (KTD2) and is now
// reachable from the conversations list header and from its existing
// creator-profile deep link, not from a top-level nav tab.
//
// A Server Component redirect (rather than a client "use client" page
// calling router.replace in an effect) avoids an unnecessary client render
// of an empty shell before navigating away — this route has no UI or
// client state of its own.
import { redirect } from "next/navigation";

export default function MessagesPage() {
  redirect("/messages/conversations");
}
