# Section 1 — Introduction

## What is GX2?

GeosonixV2 (GX2) is a creative music environment, a pattern sequencer where notes and sounds come from play heads traversing curves or wandering freely on a 2D canvas. Music is generated as play heads travel, sounding beats as they go.

What plays is shaped by the scene itself. As the cursor — what GX2 calls the play head — moves along its path, each note is influenced by what it passes over and meets — the colour and brightness of an image beneath the canvas, and the other objects it crosses. The picture becomes an instrument, and the layout of the scene becomes part of the composition.

The scene evolves as it plays. Sprites drift across the image, wafted by the colours beneath them; curves move; and a whole scene can shift from one variation to the next. Patterns meet in combinations you didn't plan. That is part of the appeal: GX2 can surprise you, turning up happy accidents you would never have reached by placing every note by hand.

For all that openness, rhythm sits at the centre. Every object keeps its own beat against a shared clock, and patterns of those beats — steady, syncopated, or subdivided into faster runs — are the backbone of how a scene sounds. Several objects can run at their own cycle lengths and still lock together on the one clock.

## What you can make

Curves and sprites can carry looping parts, melodic or rhythmic. A cursor crossing a field of fixed points becomes a drum pattern. An image can become an instrument in its own right — its brightness shaping loudness, its colours choosing pitches — so a photograph plays as a slowly shifting texture. Set a sprite moving over that same image and it reports what it finds as it goes: an autonomous voice you start in motion rather than write note by note. Move the objects, or change the image beneath them, and the same scene gives endless variations.

Small, deliberate scenes make precise, repeatable pieces. Busier ones, with objects in motion and scenes that evolve, make living, generative music that is never quite the same twice. Most pieces sit somewhere between the two — as composed or as self-driven as you care to make them.

## How GX2 works at a glance

The underlying idea is small. A scene holds three kinds of object — curves (paths), triggers (fixed points), and sprites (moving bodies) — placed on a canvas. Each object that takes part in the music carries its own cursor and its own beat points; as the piece plays, cursors travel, beats fire, and objects cross one another. Every one of those events is handed to a short script you write, which turns it into a note — choosing its pitch, loudness, length, and place in the stereo field — and sends it to the built-in synthesiser or out to an external instrument over MIDI.

A scene's music therefore comes from two things working together: the structure on the canvas — the objects and how they are arranged — and the script that decides what each event sounds like. Both are live. You can move an object or rewrite a line of the script while the piece is playing and hear the result at once, shaping the music in real time.

Pitches need not be left to chance, either: a harmonic pattern — a key, a scale, or a chord progression — can shape the notes an object generates, holding them within a chosen tonality. The sections that follow are, in the end, just the details of these few moving parts.

## Where GX2 comes from

GX2 has a long lineage. It is the modern, web-based successor to GeoSonix, a spatial music system the same author built around 2007 to 2012, which was itself based on IanniX and inspired by GeoMaestro — tools that treated a score as a drawing to be travelled rather than a strip of time to be read. Where those forebears leaned toward continuous, freeform gesture, GX2 is built for beat- and pattern-based music: rhythm is a first-class citizen, and the two-dimensional canvas is the new ground it opens.

## Who GX2 is for

GX2 is for composers and sound artists who like to think in systems — who would rather set something up and listen to it unfold than enter every note by hand. It rewards curiosity: you can get a sound out of it in a minute and still be finding new behaviours months later.

You don't have to write code to use GX2. You draw objects on the canvas with familiar tools, and set their properties and behaviour through the inspector's forms — no scripting required. Every new object also comes with working default code already in place, so it makes sound from the moment you create it. And when you're ready to go further, that code is plain JavaScript you can pick up by reading and tweaking the examples, with the editor helping as you type through autocompletion and built-in lookup.

GX2 runs in more than one place. Today it is a web app, playable in Chrome, Microsoft Edge, or Firefox; a desktop version for Mac and Windows is on the way.

## How to use this manual

You don't need to read this manual cover to cover. The quickest way in is the tutorials in Getting Started — work through those and you'll be building and playing scenes right away. From there, dip into whichever sections you need: the middle ones go deeper into each part, one idea at a time, and the Reference at the end is there whenever you want to look something up.

A few conventions. The app's full name is GeosonixV2; we call it GX2 from here on. The Reference section's tables — the keyboard shortcuts, the scripting commands, and every field — are kept in step with the app itself, so on the rare occasion this manual and the program seem to disagree, trust the program. And throughout, the quickest way to understand anything here is to try it: open a scene, change one thing, and press play.
