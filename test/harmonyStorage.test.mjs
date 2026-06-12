// Unit tests for the GX2 harmony STORAGE layer (commit 2):
//   src/harmonyScene.js   — sanitiseSceneHarmony (scene's chosen progression)
//   src/harmonyLibrary.js — PURE logic only: lightweight metadata extraction,
//                           dedupe, and CONTAINS title search/filter.
//
// These exercise ONLY the pure functions, with in-memory sample data — a
// tiny hand-crafted irealb:// payload (reusing the same plaintext-field
// shape the parser expects). They never touch localStorage and never read
// the gitignored Jazz 1460.html, so they run cleanly under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { sanitiseSceneHarmony } from "../src/harmonyScene.js";
import {
    sanitiseLibrary,
    addPlaylistToLibrary,
    removePlaylistFromLibrary,
    extractSongMetadata,
    summariseLibrary,
    searchSongsInLibrary,
    songFromPayload,
    playlistNameFromPayload,
} from "../src/harmonyLibrary.js";

// --- Sample payload --------------------------------------------------
// A tiny decoded irealb:// payload (the form extractIrealPayload returns):
// songs are "===" separated, fields "=" separated as
//   title=composer=style=key=1r34LbKcu7<body>=...
// The bodies here are short (< 50 chars) so they pass through unscramble
// untouched. Three songs across two distinct titles for search/dedupe.
const PAYLOAD =
    "Autumn Leaves=Kosma=Medium Swing=G=1r34LbKcu7T44A-7 |D7 |G^7 Z" +
    "==0=0===" +
    "Blue Bossa=Dorham=Bossa Nova=C-=1r34LbKcu7T44C-7 |F-7 |D7 Z" +
    "==0=0===" +
    "Autumn in New York=Duke=Ballad=F=1r34LbKcu7T44F^7 |E-7 Z" +
    "==0=0===" +
    "My Sample Playlist";

// =====================================================================
// Part A — sanitiseSceneHarmony
// =====================================================================

const VALID_HARMONY = {
    title: "Autumn Leaves",
    composer: "Kosma",
    key: { tonicPitchClass: 7, mode: "major" },
    timeSignature: [4, 4],
    progression: [
        { type: "timeSignature", timeSignature: [4, 4] },
        { type: "chord", raw: "A-7", chord: { degree: 2, accidental: "", quality: "-7", raw: "A-7" } },
        { type: "bar", barStyle: "single" },
        { type: "chord", noChord: true },
        { type: "end" },
    ],
};

test("sanitiseSceneHarmony: a well-formed value passes and is copied", () => {
    const out = sanitiseSceneHarmony(VALID_HARMONY);
    assert.ok(out);
    assert.equal(out.title, "Autumn Leaves");
    assert.equal(out.composer, "Kosma");
    assert.deepEqual(out.key, { tonicPitchClass: 7, mode: "major" });
    assert.deepEqual(out.timeSignature, [4, 4]);
    assert.equal(out.progression.length, 5);
    // fresh object + fresh progression array (no aliasing).
    assert.notEqual(out, VALID_HARMONY);
    assert.notEqual(out.progression, VALID_HARMONY.progression);
    assert.notEqual(out.key, VALID_HARMONY.key);
});

test("sanitiseSceneHarmony: minor key and 3/4 are accepted", () => {
    const out = sanitiseSceneHarmony({
        title: "Minor Waltz",
        composer: "X",
        key: { tonicPitchClass: 9, mode: "minor" },
        timeSignature: [3, 4],
        progression: [],
    });
    assert.ok(out);
    assert.deepEqual(out.key, { tonicPitchClass: 9, mode: "minor" });
    assert.deepEqual(out.timeSignature, [3, 4]);
    assert.deepEqual(out.progression, []);
});

test("sanitiseSceneHarmony: malformed inputs all return null", () => {
    const bad = [
        null,
        undefined,
        42,
        "nope",
        [],
        {},                                            // missing everything
        { ...VALID_HARMONY, title: 5 },                // non-string title
        { ...VALID_HARMONY, composer: null },          // non-string composer
        { ...VALID_HARMONY, key: null },               // no key object
        { ...VALID_HARMONY, key: { tonicPitchClass: 7 } },        // no mode
        { ...VALID_HARMONY, key: { tonicPitchClass: 12, mode: "major" } }, // pc out of range
        { ...VALID_HARMONY, key: { tonicPitchClass: 1.5, mode: "major" } }, // non-integer pc
        { ...VALID_HARMONY, key: { tonicPitchClass: 7, mode: "dorian" } },  // bad mode
        { ...VALID_HARMONY, timeSignature: [4] },      // wrong length
        { ...VALID_HARMONY, timeSignature: "4/4" },    // wrong type
        { ...VALID_HARMONY, timeSignature: ["4", "4"] }, // non-number members
        { ...VALID_HARMONY, progression: "notarray" }, // bad progression
        { ...VALID_HARMONY, progression: [{ noType: true }] },     // cell missing type
        { ...VALID_HARMONY, progression: [null] },     // non-object cell
        { ...VALID_HARMONY, progression: [{ type: 3 }] }, // non-string type
    ];
    for (const v of bad) {
        assert.equal(sanitiseSceneHarmony(v), null, `expected null for ${JSON.stringify(v)}`);
    }
});

// =====================================================================
// Part B — harmonyLibrary pure logic
// =====================================================================

// --- lightweight metadata extraction ---------------------------------

test("extractSongMetadata: pulls titles/composers/keys from plaintext", () => {
    const metas = extractSongMetadata(PAYLOAD);
    assert.equal(metas.length, 3);

    assert.deepEqual(metas[0], {
        index: 0,
        title: "Autumn Leaves",
        composer: "Kosma",
        key: { tonicPitchClass: 7, mode: "major" },
        supported: true,
    });
    assert.equal(metas[1].title, "Blue Bossa");
    assert.deepEqual(metas[1].key, { tonicPitchClass: 0, mode: "minor" }); // C-
    assert.equal(metas[2].title, "Autumn in New York");
    assert.deepEqual(metas[2].key, { tonicPitchClass: 5, mode: "major" }); // F
});

test("extractSongMetadata: unparseable key marks song unsupported", () => {
    const payload =
        "Weird=Nobody=Free=H=1r34LbKcu7T44C^7 Z==0=0===Tiny List";
    const [m] = extractSongMetadata(payload);
    assert.equal(m.key, null);
    assert.equal(m.supported, false);
});

test("playlistNameFromPayload: reads the trailing playlist name", () => {
    assert.equal(playlistNameFromPayload(PAYLOAD), "My Sample Playlist");
});

test("songFromPayload: lazily builds a full Song; out-of-range -> null", () => {
    const song = songFromPayload(PAYLOAD, 0);
    assert.ok(song);
    assert.equal(song.title, "Autumn Leaves");
    assert.deepEqual(song.timeSignature, [4, 4]);
    assert.ok(song.progression.length > 0); // full expansion happened
    assert.equal(songFromPayload(PAYLOAD, 99), null);
    assert.equal(songFromPayload(PAYLOAD, -1), null);
});

// --- dedupe ----------------------------------------------------------

test("addPlaylistToLibrary: fresh name appends with a generated id", () => {
    let n = 0;
    const makeId = () => `id${++n}`;
    const r1 = addPlaylistToLibrary([], "List A", "payloadA", makeId);
    assert.equal(r1.id, "id1");
    assert.equal(r1.library.length, 1);

    const r2 = addPlaylistToLibrary(r1.library, "List B", "payloadB", makeId);
    assert.equal(r2.id, "id2");
    assert.equal(r2.library.length, 2);
});

test("addPlaylistToLibrary: dedupes by name, replacing payload, keeping id", () => {
    let n = 0;
    const makeId = () => `id${++n}`;
    const r1 = addPlaylistToLibrary([], "List A", "old", makeId);
    const r2 = addPlaylistToLibrary(r1.library, "List A", "new", makeId);

    assert.equal(r2.id, "id1");           // same id reused
    assert.equal(r2.library.length, 1);   // no duplicate added
    assert.equal(r2.library[0].payload, "new"); // payload replaced
    assert.equal(n, 1);                   // makeId not called on the re-import
});

test("removePlaylistFromLibrary: drops the matching id only", () => {
    const lib = [
        { id: "a", name: "A", payload: "x" },
        { id: "b", name: "B", payload: "y" },
    ];
    const out = removePlaylistFromLibrary(lib, "a");
    assert.deepEqual(out.map((e) => e.id), ["b"]);
    // unknown id is a no-op.
    assert.equal(removePlaylistFromLibrary(lib, "zzz").length, 2);
});

test("sanitiseLibrary: keeps valid entries, drops malformed ones", () => {
    const parsed = [
        { id: "a", name: "A", payload: "p" },
        { id: "", name: "B", payload: "p" },   // empty id -> dropped
        { id: "c", name: 5, payload: "p" },     // non-string name -> dropped
        { id: "d", name: "D", payload: 7 },     // non-string payload -> dropped
        null,                                   // non-object -> dropped
        { id: "e", name: "E", payload: "q" },
    ];
    assert.deepEqual(sanitiseLibrary(parsed).map((e) => e.id), ["a", "e"]);
    assert.deepEqual(sanitiseLibrary("notarray"), []);
});

// --- summarise -------------------------------------------------------

test("summariseLibrary: reports id, name, and song count", () => {
    const lib = [{ id: "p1", name: "My Sample Playlist", payload: PAYLOAD }];
    assert.deepEqual(summariseLibrary(lib), [
        { id: "p1", name: "My Sample Playlist", songCount: 3 },
    ]);
});

// --- CONTAINS search / filter ----------------------------------------

const LIBRARY = [
    { id: "p1", name: "Sample One", payload: PAYLOAD },
    {
        id: "p2",
        name: "Sample Two",
        payload:
            "Autumnal Theme=Z=Latin=D=1r34LbKcu7T44D^7 Z==0=0===Sample Two",
    },
];

test("searchSongsInLibrary: case-insensitive CONTAINS over titles, all scope", () => {
    const hits = searchSongsInLibrary(LIBRARY, "autumn");
    // "Autumn Leaves" (p1/0), "Autumn in New York" (p1/2), "Autumnal Theme" (p2/0)
    assert.equal(hits.length, 3);
    const titles = hits.map((h) => h.title).sort();
    assert.deepEqual(titles, [
        "Autumn Leaves", "Autumn in New York", "Autumnal Theme",
    ]);
    // hits carry playlist id + name + index for the UI.
    const leaves = hits.find((h) => h.title === "Autumn Leaves");
    assert.equal(leaves.playlistId, "p1");
    assert.equal(leaves.playlistName, "Sample One");
    assert.equal(leaves.index, 0);
});

test("searchSongsInLibrary: scope restricts to one playlist", () => {
    const hits = searchSongsInLibrary(LIBRARY, "autumn", { scope: "p2" });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].title, "Autumnal Theme");
    assert.equal(hits[0].playlistId, "p2");
});

test("searchSongsInLibrary: substring (not just prefix) matches", () => {
    const hits = searchSongsInLibrary(LIBRARY, "bossa");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].title, "Blue Bossa");
});

test("searchSongsInLibrary: empty/whitespace query returns no hits", () => {
    assert.deepEqual(searchSongsInLibrary(LIBRARY, ""), []);
    assert.deepEqual(searchSongsInLibrary(LIBRARY, "   "), []);
});

test("searchSongsInLibrary: a miss returns an empty array", () => {
    assert.deepEqual(searchSongsInLibrary(LIBRARY, "zzznotitle"), []);
});
