# Hollowmere: Design Doc

| | |
|---|---|
| Status | Draft v3. Mockup done, production build not started. Name, gate guardian and mood board settled. |
| Author | Victor Zhang, with Claude |
| Date | 2 October 2026 |
| Mockup | `docs/mockup/hollowmere-mockup.html`: a single-file Three.js block-out. Open it in a browser. |
| License | MIT, for the code, art and music alike (`LICENSE`) |

---

## 1. Summary

Hollowmere is a web app where you are a ghost drifting through a haunted castle on a cliff above a moonlit lake. It opens on autofly, a slow cinematic flight along a route through the best views. At any moment you can take over and fly anywhere, including through walls. When you stop touching the controls, autofly eases back in.

It is a mood piece, not a game. There are no goals, scores or enemies. Success means someone opens it on the evening of 31 October, leaves it running on a second monitor, and keeps coming back to fly through the great hall.

The visual target comes from a mood board (§3a), not one picture: a cold blue moonlit night, hundreds of warm amber windows, mist on the water, a glowing route of lanterns and pumpkins leading up to the castle, a dragon circling the highest spire, and wandering ghosts.

## 2. Goals and non-goals

**Goals**
- Feel like flying into the painting. Mood and light matter more than geometric detail.
- Free roaming everywhere, plus autofly that always looks composed.
- Interactive within 3 seconds on an ordinary connection. Everything else streams in while you fly.
- Runs well on a mid-range laptop and a three-year-old phone.
- Original world and creatures, safe for an open-source repo that anyone can fork.
- Layered, location-aware music and ambience.
- Easy to contribute to: world layout, route and audio zones live in data files, not in code.

**Non-goals (v1)**
- Gameplay, quests, collectibles.
- Multiplayer and other players' ghosts.
- Accounts, saving, analytics.
- VR. It's an easy later addition, but not now.
- Any runtime AI calls. The shipped app makes no API requests.

## 3. Decisions made so far

| Decision | Why |
|---|---|
| **True 3D, not 2.5D painted layers.** | Free roaming breaks parallax tricks. Depth-displaced paintings only hold within about 25° of their viewpoint. 3D gives every angle, interiors, and fire that lights the walls. The mockup showed that primitives plus fog, warm emissives and bloom already read as the painting from a distance. |
| **Free roaming and autofly, sharing one flight model.** | Autofly is the default, the screensaver mode, and the mobile-friendly mode. Because both use the same physics, handing control back and forth is seamless. |
| **Generated art is a build step, never runtime.** | No API keys in the client or the repo, zero runtime cost, and no waiting. The generation script lives in the repo, but the curated outputs are what ships. |
| **Generated imagery is used for textures, sky and sprites, not for whole scenes.** | Image models are good at tileable stone, slate, stained glass, skies and sprite sheets. They are bad at keeping one building consistent across viewpoints, and 3D removes the need for that. |
| **Streamed asset budget of about 60 MB (desktop) and about 30 MB (mobile), with a critical path of 5 MB or less.** | The agreed budget was 30–100 MB, but it must stream. The first frame cannot wait for it. |
| **Original IP only.** | No owls carrying sealed letters, no chained three-headed dog, no lakeside wizard-school cues. Castles, dragons, bats, pumpkins, ghosts, gargoyles and spiders are shared Halloween vocabulary and stay. |
| **Single dark visual world.** | It is always night. The UI chrome is dark glass with parchment-colored type. |
| **The name is Hollowmere.** | "Hollow" for All Hallows and for a ghost's emptiness, "mere" for the lake it opens on. One word, names the world rather than the app. A small browser game called "Echoes of Hollowmere" exists; check the trademark database and GitHub before creating the repo. |

## 3a. Mood board

Two generated paintings so far, and the board is open to more. Neither is shipped or copied; each lends specific things. Rule: take a quality, never a composition.

**Painting A: the blue lake night.** Castle on a cliff over a mirror lake, cold blue-grey key light, amber windows, mist on the water, a dragon over the spires.
- Taken: the palette (deep blue sky, never black; warm light rare and concentrated), the opening composition from the lake, the dragon's fire as the only big warm event in the sky, the lakeside boathouse.
- Left: the floating pumpkin cloud, the owl with a letter, the chained three-headed hound.

**Painting B: the warm approach.** A cobbled path lined with lanterns and pumpkins winding up to the castle, a huge amber moon behind it, waterfalls off the cliff, a village below, a black cat and crows in the foreground, ghosts drifting beside the path, statues holding lanterns, a witch silhouette across the moon.
- Taken: the idea that the route itself glows (lanterns and pumpkins line the way, so the eye and autofly follow the same path), waterfalls off the cliff into the lake, a few village lights across the water for scale, a larger moon, foreground cats and crows, lantern-bearing statues at the gate, cobwebs catching light.
- Left: the overall orange cast (our night stays blue, with warmth only where there's a flame), the sheer density. B has every Halloween motif at once; we take its route idea and its cast, not its clutter.

**Open to add:** a graveyard on the eastern slope, a witch's silhouette crossing the moon once a session, a crypt under the keep. Anything new goes on the board with the same two lists.

## 4. The experience

1. **Open.** Moon and sky are already moving behind a short title fade. You are hovering over the lake. The castle is centered with the moon just behind its west towers. A wyrm circles the keep and lanterns flicker on the viaduct.
2. **Autofly** drifts low over the water, rises up the cliff, and passes *through* the great hall's stained glass into a hall of floating candles. It then exits east along the viaduct, sweeps through the jack-o'-lantern courtyard, passes the gate and its gargoyles, climbs to the keep's spires beside the dragon, and swings out over the lake to start again. One loop takes about 2.5 minutes.
3. **Take over** at any time: drag to look, keys or stick to move. Looking alone does not cancel autofly. You can look around while it carries you.
4. **Let go.** After 12 seconds without movement input, autofly fades back in from the nearest point on the route.
5. **Sound** starts with the first tap on the Sound button (browsers require a gesture). A low drone is always present. A choir rises as you near the hall, and the dragon's roar arrives with its fire.

### Points of interest (the "beautiful places")

| Place | What makes it worth flying to |
|---|---|
| Lake opening shot | The painting's composition, moon reflection, mist, boathouse lights |
| Great hall interior | Floating candles, tall stained glass seen from inside, long tables, two resident ghosts |
| Viaduct | Two-tier arches, lantern-lined deck, pumpkins drifting over it |
| Gate courtyard | Pumpkin cloud, gargoyles, banners, iron gates, ghosts, stairs down to the shore |
| Keep spires | Height, wind, the dragon's fire lighting the spire, bats against the moon |
| Boathouse and lake | Lantern boat, will-o'-wisps over the water, pier |

## 5. World layout

Units are metres, with y up and the lake surface at y = 0. These are the mockup's values and the starting point for `data/world.json`.

| Landmark | Values |
|---|---|
| Castle cliff | Rock column centred at (0, 0). Top radius 82, bottom radius 106. Plateau at y = 40, base at y = −26. Edge noise about ±10%. |
| Gate outcrop | Centre (172, 66). Top radius 30, bottom radius 41. Top at y = 30. |
| Lake | Ellipse centre (−190, 170), radii 300 × 240. Bed at y = −12 with a smooth shoreline falloff. |
| Mountains | Ridged-noise ring from radius 360 to 760, tallest to the north, snow above about 200 m. |
| Great hall | x −38 → 28, z 33 → 55. Floor 40, walls 24, ridge +16. Nine bays per long side. South facade faces the lake. |
| Keep | (6, −20), radius 9, shaft 84, spire 42 (top about 166) |
| West towers | (−56, 8) r 6.5 h 74; (−44, −16) r 5 h 60. These frame the moon in the opening shot. |
| Perimeter towers | Ten towers on radius 70 at 160°, 185°, 212°, 238°, 262°, 288°, 314°, 340°, 4°, 30°. Bases sunk to y = 18 so they grow out of the cliff face. |
| Curtain walls | Between consecutive perimeter towers, except 4°→30°, where the viaduct enters. Two short walls tie into the hall's north corners. |
| Viaduct | From A (70, 40.4, 18) to B (150, 31.2, 57). Eight spans, two tiers of pointed arches, 7 m deck with parapets. |
| Gate | (172, 30, 86), facing +z. Pillars at x ± 6, iron leaves swung inward. Stairs descend south to the shore. |
| Boathouse | On the western shore, found by marching from the lake centre toward (−150, −120). Pier extends into the water. |
| Moon | Direction `normalize(0.777, 0.4, −0.629)`. About 23° above the horizon, just left of the castle from the opening shot. Mockup disc is 360 m at 3,600 m (about 5.7°). Try 1.5× that; painting B's moon is a backdrop, not a dot. |
| Waterfalls | Two off the castle cliff's south face into the lake, one off the gate outcrop. Particle sheets plus mist at the base (from painting B). |
| Village | A dozen lit windows and a chapel spire on the far western shore, about (−420, 0, 120). Scale cue only; unreachable past the soft boundary. |
| World bounds | Soft boundary at radius 620 (fog thickens from 600 to 720). Ceiling at 340. |

## 6. The ghost: flight and camera

**Body.** A lathe-sheet ghost about 2.6 m tall: dome head, flared skirt, wavy hem animated in the vertex shader. A fresnel-rim translucent material, two dark eyes and a small "o" mouth. The skirt bends against velocity and the body banks into turns. Wisp particles trail from the hem.

**Flight model** (values tuned in the mockup):

| Parameter | Value |
|---|---|
| Cruise / boost speed | 17 m/s / 40 m/s (Shift) |
| Velocity smoothing | Exponential toward target, k = 1.7 (manual), 2.4 (autofly) |
| Look sensitivity | 0.0034 rad/px yaw, 0.003 rad/px pitch; pitch clamp ±1.25 rad |
| Movement | Relative to view: forward follows pitch, so looking up and pressing W climbs |
| Rise / sink | Space or E / Q or C; on touch, ▲ ▼ buttons |
| Ground clearance | Stays 1.8 m above terrain, water and rock. Eases up instead of colliding, so it floats up cliff faces. |
| Walls | No collision. Crossing any wall or tower volume triggers a 0.6 s "phase" effect (warm wash, ripple, chromatic shift) and a whoosh. |
| Bob | ±0.35 m at 1.7 rad/s (off under reduced motion) |

**Camera.** Third person, behind and above the ghost. Distance is 11 m on landscape screens and 15 m on portrait, multiplied by a wheel or pinch zoom of 0.4–2.4×. Height is 1.6 + 0.18 × distance. FOV is 55° on landscape and 68° on portrait. The camera position follows with smoothing (k = 7) and never dips below ground + 1 m. The ghost sits in the lower centre of the frame.

## 7. Autofly

**Route data.** `data/route.json` holds a closed list of waypoints `[x, y, z, speed]`, interpolated as a centripetal Catmull-Rom curve. Speed runs from 6.5 m/s inside the hall to 22 m/s on the open legs. The mockup's 24 waypoints are the v1 route:

```
[-350,22,175,20] [-240,14,168,18] [-150,7,140,15] [-92,20,104,12]
[-48,44,86,10]   [-16,49,70,8]    [-6,50,46,6.5]  [16,50,42,6.5]
[44,56,40,9]     [90,48,36,11]    [145,42,60,9]   [170,37,74,7]
[172,35,96,7]    [158,40,140,11]  [90,82,122,14]  [30,125,62,14]
[-34,140,-6,12]  [8,146,-80,12]   [62,124,-36,13] [10,94,118,16]
[-130,62,230,20] [-270,44,330,22] [-380,34,290,22] [-420,26,215,20]
```

**Algorithm.**
- A carrot point moves along the curve at the waypoint speed. Its advance is throttled when the ghost lags more than 28 m behind.
- Desired velocity = 0.9 × (carrot − position) + 0.6 × speed × tangent, capped at 1.9 × speed.
- The autofly weight `w` ramps in at 0.45/s and out at 4/s. Final target velocity = lerp(player input, autofly, w).
- **Look direction** is 32 m ahead on the route. When the ghost is far from the castle, it is biased toward the castle centre (5, 70, 5) with weight 0.8 × smoothstep(150, 360, distance). This keeps distant legs composed.
- **Look hold.** Dragging to look suspends autofly's look control for 3 s. It does not cancel autofly movement.
- **Override.** Any movement input sets override. After 12 s of no movement input, override clears and the carrot jumps to the nearest route point (sample 900 points).
- **F** toggles autofly entirely. When it is turned on, it resyncs to the nearest point.

**Production additions.**
- An in-app route editor (dev builds only): show the curve, drag waypoints, edit speeds, export JSON.
- Optional per-waypoint look targets for shots that need a specific framing.
- Several routes, picked at random or by time, so long sessions vary.

## 8. Rendering

**Pipeline.** Render into an HDR half-float target with 4× MSAA, then bloom, then a final grade pass. The grade pass applies exposure 1.35, ACES tone mapping, a mild S-curve (0.3), a split tone (cool shadows, warm highlights), vignette, light grain and subtle edge chromatic aberration. It does the sRGB conversion itself. Use the color-managed pipeline: hex colors are sRGB and lighting is linear.

**Lighting.**
- A moon directional light (#a9bde2) casts a shadow map over the castle. The shadow map is rendered once, because the world is static.
- A hemisphere fill light: sky #4b5c85, ground #1c140e.
- Six or fewer warm point lights: gate, pumpkin clusters, hall interior, boathouse, lantern boat, and the dragon's fire, which flickers to about 5 while breathing.
- Windows are emissive textures, not lights. Bloom does the rest.

**Fog and atmosphere.**
- Exponential-squared fog in #2a3349, density 0.00125.
- The sky is a gradient dome with a moon halo, stars, and cloud billboards lit by their angle to the moon.
- Mist banks are soft billboards. In production, use soft particles that read the depth buffer, so mist never slices visibly into water or rock. That slicing was a real bug in the mockup.

**Water.** A planar reflection at half resolution, with a ripple distortion that grows with distance. Fresnel blends between a near-black base and the reflection. The water shader applies fog itself. Production could add flow-mapped normals and a moon glitter path.

**Emissive and bloom restraint.** Bloom strength 0.7, radius 0.5, threshold 1.0. Emissive intensities: tower windows 2.1, hall glass 1.55, pumpkin faces 2.4. The first mockup pass used about 1.5× those values and turned the hall interior into white mush. Treat these as tuned constants and change them only while looking at the result.

**Look targets.** The painting's palette: the sky stays deep blue-grey, never black. Warm light is concentrated in windows, lanterns and pumpkins, and stays rare everywhere else. Autumn foliage is muted rust, not saturated orange. Stone is neutral-warm grey; blue-tinted stone turns pink under warm lights.

**Quality tiers.** Detected at start and adapted at runtime.

| Tier | Pixel ratio | Reflection | Shadows | MSAA | Bloom mips |
|---|---|---|---|---|---|
| High | up to 1.5 | 0.5× | 2048 | 4× | 5 |
| Medium | 1.0 | 0.33× | 2048 | 2× | 4 |
| Low (most phones) | 0.75–1.0 | probe or flat | 1024 baked | off | 3 |

The mockup already lowers the pixel ratio when fps stays under 38. Keep that behavior and add tier switching.

**Performance budget.**
- 60 fps on a mid-range laptop at 1080p; 30 fps or more on a three-year-old phone.
- Fewer than 300 draw calls. Instance everything that repeats: merlons, trees, pumpkins, candles, bats, dragon segments.
- Fewer than 1.5 M triangles on screen.

## 9. Content inventory

**Castle kit** (modular, assembled from layout data):
- Round towers: shaft, corbel band, conical slate spire, iron finial, optional four pinnacles.
- Curtain walls with merlons.
- Great hall: lancet bays, buttresses with pinnacles, gabled slate roof, flèche, interior with floor, tables and benches.
- Viaduct spans (two tiers) and piers.
- Gate pillars with caps, iron leaves, flanking walls, stairs.
- Boathouse with tower and pier.

In production, every piece becomes a proper low-poly mesh with UVs, either procedural in code or modelled in Blender and exported as glTF (see §16). Detail goes where the route passes close: the gate, the hall interior, the viaduct deck, and the cliff face on the approach.

**Set dressing.**
- About 2,600 instanced conifers on the hills.
- About 450 autumn trees on the shore, the plateau edge and the outcrop. These need a better silhouette than the mockup's blobs: use cards or clustered leaf meshes.
- Cobwebs at three spots.
- Banners with an original crest: a gold crescent over three spires on deep red.

**Life.**
- **The wyrm.** Original design. About 46 instanced body segments following a looping path around the keep at about 146 m, with back spikes, a horned head with a hinged jaw, and bat-like wings. It breathes fire every 8–13 s for 2.4 s. Production should give it a proper skinned glTF with the same path logic.
- **Bats.** 90 instanced pairs of wings in three flocks: west towers, keep, and gate.
- **Ghosts.** 8 wandering NPC ghosts using the player's shader: 4 at the gate, 2 in the hall, 1 on the viaduct, 1 at the pier.
- **Jack-o'-lanterns.** About 40 instanced, nearly all sitting on parapets, posts, sills and steps along the route, about eight drifting near the gate, plus one giant above the gate. See §10.
- **Hall candles.** 150 floating candles with flicker.
- **Lake.** A lantern boat on a slow loop and 12 will-o'-wisps.
- **Gate guardian.** The Lantern Warden, see §10.

## 10. Creature bible

Every creature gets the same five entries: look, behavior, how it reacts to you, sound, and cost. "Reacts to you" is the one the mockup skips entirely, and it is what turns a diorama into a place. The rule for reactions: small, cheap, and never blocking. Nothing ever stops you, chases you or asks anything of you.

All creatures are original designs. None may resemble a character from a film, book or game, and contributors adding one must say in the PR what it is based on.

### The player ghost
- **Look.** About 2.6 m, dome head, flared skirt with a wavy hem, two dark eyes and a small round mouth. Pale blue-white, fresnel rim, translucent. Banks into turns, skirt bends against velocity, wisps trail from the hem.
- **Behavior.** See §6.
- **Reacts.** Passing through a wall: phase effect. Passing a candle or lantern: the flame bends away. Passing through a pumpkin: it spins and its face flares. Flying through a bat flock: it scatters.
- **Sound.** Whoosh through walls, a soft breath while boosting.
- **Cost.** One mesh, one shader, about 260 trail particles.

### Wandering ghosts (8)
- **Look.** Same mesh and shader as the player, dimmer (glow 0.9), sizes 1.6–2.2. Give each one a small difference in production: a hat, a lantern, a longer skirt, a chain.
- **Behavior.** Slow loops around a home point: four at the gate, two in the hall, one on the viaduct, one at the pier. In production, give them two or three idle actions each (pause and sway, peer through a window, drift up a stair).
- **Reacts.** When you come within about 10 m, one turns its head toward you and bobs once, like a nod. In the hall, the two ghosts move apart to let you through. No speech, no faces beyond the dots.
- **Sound.** A faint sigh when they nod, attenuated by distance.
- **Cost.** 8 draws; no shadows.

### The wyrm
- **Look.** A serpentine dragon about 60 m long: about 46 tapered body segments, iron-dark hide with ember-red between the scales, a row of back spikes, a horned head with a hinged jaw, and bat-like wings at about segment 9. Not a Western four-legged dragon, so it reads as its own creature.
- **Behavior.** A looping path around the keep at about 146 m, radius 56 m, with lazy vertical drift. Breathes fire for 2.4 s every 8–13 s; the fire is a particle stream plus a point light that flickers to about 5 and lights the spire.
- **Reacts.** If you climb above about 130 m near the keep, the next pass flies 20 m closer and the head tracks you for a moment. It never comes closer than 15 m and never breathes fire at you; the fire is always aimed along its path.
- **Sound.** Roar with each breath, attenuated by distance; a wing beat when it passes within 40 m.
- **Cost.** 2 instanced draws for body and spikes, a head group, 2 wing meshes, about 420 fire particles, 1 point light. Production: one skinned glTF with the same path driver.

### Bats (90)
- **Look.** Flat two-wing silhouettes, black, 0.9–1.5 m span.
- **Behavior.** Three flocks orbit the west towers, the keep and the gate, with per-bat wander and a 9–13 Hz flap.
- **Reacts.** Scatter outward when the ghost enters the flock, and regroup over 4 s. Occasionally a few cross the moon.
- **Sound.** Faint chitter when within 15 m.
- **Cost.** 2 instanced draws.

### Jack-o'-lanterns (about 40, mostly grounded)
- **Look.** Ribbed sphere with a stem, carved faces with a warm emissive glow. Three or four face variants in production. One giant (about 4 m) above the gate.
- **Behavior.** The mockup floats about 60 in clouds, and that is too many and the wrong idea. Pumpkins sit on things: along the viaduct parapet, on the gate posts and stair landings, on the hall's window sills, in a heap by the boathouse door. Together with the lanterns they draw a glowing line along the route, which is what the eye follows and what autofly flies. Only about eight drift, and those stay near the gate so the floating ones read as a local magic, not the weather.
- **Reacts.** Passing through one spins it and makes its face flare for a second.
- **Sound.** None by themselves; the gate zone has a crackle layer.
- **Cost.** 2 instanced draws plus a glow sprite batch.

### Hall candles (150)
- **Look.** Short white candles with a flame sprite.
- **Behavior.** Float at 8–19 m above the hall floor, bob, flicker.
- **Reacts.** Flames bend away from the ghost within 3 m; those it passes through go out and relight after 2 s.
- **Sound.** Part of the hall ambience.
- **Cost.** 1 instanced draw plus one sprite batch.

### Gargoyles (2 at the gate, more on towers in production)
- **Look.** Crouching, horned, winged, carved from the same stone as the pillar.
- **Behavior.** Static.
- **Reacts.** When you hover within 6 m, the head turns to follow you, slowly, and turns back when you leave. The only "wrong" thing a statue can do, so it stays rare: only the gate pair do this.
- **Sound.** A stone grind on the turn.
- **Cost.** Negligible.

### Spider (1 giant, several small)
- **Look.** The painting has large spiders on the walls. One giant spider, about 4 m, sits on a web on the west tower. Small ones sit on the three cobwebs.
- **Behavior.** Still. The giant one shifts a leg every 10–20 s.
- **Reacts.** Pulls its legs in when you pass within 5 m.
- **Sound.** None. Silence is scarier.
- **Cost.** One low-poly mesh; small ones are sprites.

### Owls (3)
- **Look.** Barn owls, pale, broad wings. They carry nothing. An owl in flight is generic; an owl with a sealed letter is not.
- **Behavior.** Long glides between the boathouse, the shore trees and the gate stairs, with a perch stop at each end.
- **Reacts.** If you come within 8 m of a perched one, it launches.
- **Sound.** One hoot when it perches, a soft wingbeat on launch.
- **Cost.** One rigged glTF with a two-pose flap, or a sprite sheet.

### Will-o'-wisps (12) and the lantern boat
- **Look.** Blue-green glows over the lake; a flat-bottomed boat with a cabin and a lantern pole, no visible rower.
- **Behavior.** Wisps wander within 30 m of home points. The boat follows a slow loop near the pier.
- **Reacts.** Wisps drift toward you when you hover over the water and scatter if you dive at them. The boat's lantern brightens as you pass.
- **Sound.** Faint wind chime for wisps; creak and lapping for the boat.
- **Cost.** One sprite batch, one small mesh group, one point light.

### Black cats (3) and crows (15)
- **Look.** Cats: sleek, yellow-eyed, sitting on the gate wall's parapet, the end of the pier and a hall window sill, about twice life size. Crows: raven-sized, on the merlons of the gate's walls (the bare trees are scattered procedurally, so there was no branch to land on) and the boathouse ridge, and in two flocks on the ground below the gate stairs.
- **Behavior.** Cats are still, with a flick of the tail every 8–18 s. Crows on the ground peck and hop.
- **Reacts.** A cat's head and eyes track you within 30 m and its eyes glow brighter as you near; it never moves off its perch. Crows take off when you pass within 8 m, circle once or twice, land again.
- **Sound.** One crow caw per takeoff, and a stray caw now and then; cats are silent.
- **Cost.** One instanced draw each (src/life/rig.ts).

### The valley's animals (12 deer, 5 wolves, 2 foxes, 9 hares)
Added at launch: the ground away from the castle read as empty. Based on red deer, grey wolves, red foxes and hares, stylised and scaled up with the world (deer elk-sized, the wolves dire wolves) so they read from autofly's height.
- **Look.** Built from rig parts: two-tone coats, a deer stag's antlers, the wolves dark with a ruff, the fox rust with a white-tipped brush, the hares pale with black ear tips. Eyes shine back at the camera when a head turns toward it.
- **Behavior.** In the valley below the gate stairs, where autofly comes down low. Deer graze in two herds and wander, lifting their heads to look round; the wolves rest and trot about a rise, and the pack howls at the moon together every 22–45 s; foxes trot a round, stopping to sniff; hares feed and hop. They keep to open, dry, gentle ground.
- **Reacts.** Within notice range (30–80 m) they stop and watch you, the head following you. Come close (12–26 m) and they run: deer bound away flashing white tails, hares jink, foxes bolt, wolves only trot off. Nothing ever comes toward you.
- **Sound.** None (synthesized howls would sound like the wind that was cut).
- **Cost.** One instanced draw per kind and one for all the eyes; not drawn past about 420 m.

### The feast in the great hall
Added at launch, to make the hall grand. Based on the medieval great-hall feast and the folk of Halloween. Deliberately not any particular film's banquet: no house banners or crests, no sorting, no enchanted ceiling. The banners carry the castle's own crest and Halloween sigils.
- **Look.** About 150 guests (fewer on the low tier) at four long tables: skeletons, witches, vampires, werewolves, mummies, pumpkin-heads and translucent ghosts. At the high table, a headless host on the throne holds up his own glowing jack-o'-lantern head (the headless horseman of folklore, seated), among a crowned skeleton and a lord of each other kind. Tables in red linen (velvet at the high table) laid with plates, goblets, roasts, pies, fruit, cakes, skull candles and little green-glowing cauldrons; iron wheel chandeliers, torches and banners on the piers; cart-sized jack-o'-lanterns; a witch stirring a great green cauldron before the dais; bats under the roof.
- **Behavior.** Guests chat with their neighbours, drink, eat and laugh.
- **Reacts.** Within 16 m they turn to watch you; within 7 m they raise their goblets to you. The host's head flares as you come near; the witch looks up from her pot.
- **Sound.** The hall's choir; nothing new.
- **Cost.** About 30 draws and 240k triangles (fewer guests on the low tier), drawn only while the camera is in the hall. While it is, nothing outdoors is drawn, since the walls and glass hide it.

### Witch silhouette (event, not a creature you can reach)
- **Look.** A flat black silhouette on a broom, far away.
- **Behavior.** Crosses the moon once every 5–8 minutes, 4 s, then gone. Pure sky event (see §19). Generic enough to be safe; it carries no named props.

### The Lantern Warden (gate guardian)
- **Look.** A 5 m hooded figure woven from tree roots and iron bands, standing beside the left gate pillar. Where a head would be, an iron lantern with amber glass. The roots trail into the ground so it reads as grown there, not placed.
- **Behavior.** Still, except the lantern's flame, which flickers like the others.
- **Reacts.** Within about 20 m, the lantern turns to follow you (a spotlight, so your ghost throws a long shadow across the courtyard). It turns back over 3 s after you leave. It never moves its body.
- **Sound.** A low creak of roots as the lantern turns; the gate zone's chain layer.
- **Cost.** One mesh, one spotlight with shadows (the only spotlight shadow in the scene; keep it at 1024).
- **Rejected alternatives,** kept for the record: a stone moth over the gate arch that opens its wings to show glowing eye spots, and a single sleeping stone hound. The moth may return as the keeper of the hall's great window later.

## 11. Asset pipeline

Generation happens offline and shipped files are committed.

```
prompts/*.yaml  →  tools/generate.ts  →  assets/raw/        (gitignored)
                                       ↓  human curation (pick, reject, regenerate)
                   tools/process.ts   →  public/assets/     (committed, compressed)
                                       →  public/assets/manifest.json
```

- **Generator.** Calls OpenAI's image API with the current image model. The key comes from `OPENAI_API_KEY` in the developer's environment and never touches the repo or the client. Each prompt file records its prompt, size, model and the date generated. Outputs are not reproducible bit-for-bit, so **the committed processed assets are the source of truth**. Prompts are kept for regenerating and extending.
- **Style guide** (prepended to every prompt): moonlit night, cold blue key light, warm amber practical lights, painterly but not cartoonish, no text, no logos, no recognizable characters or franchises.
- **Asset types.**
  - Tileable albedo: castle stone, slate roof, flagstone, rock, bark.
  - Window atlases: stone with lit, dim and dark lancets, plus matching emissive masks.
  - Stained-glass bays.
  - Banners and crest.
  - Sky: clouds and moon.
  - Sprite sheets: mist, flame, wisps, pumpkin faces.
  - Mountain and far-shore imposter strips.
- **Processing.**
  - Make textures seamless: offset, then inpaint the seams with the same API, then verify.
  - Derive height, normal and roughness from luminance where no dedicated map exists.
  - Downscale to 2K or 1K, and to 1K or 512 for the mobile tier.
  - Encode as KTX2 (ETC1S for albedo, UASTC for normals and masks).
  - Optimize glTF meshes with meshopt via glTF-Transform.
- **Budgets.** Up to about 60 MB for the desktop tier and about 30 MB for the mobile tier, including audio.

## 12. Loading and streaming

1. **Critical path, 5 MB or less, interactive in under 3 s.** App code (about 400 KB gzipped), sky and moon, terrain and castle with low-resolution textures, the opening-shot materials, and the UI font.
2. **Immediately after.** Full-resolution textures in route order: lake, cliff, hall facade, hall interior, viaduct, gate, keep.
3. **On demand.** Creature meshes as the route approaches them, far-mountain imposters, and music stems after the Sound button is pressed.

A loading state never blocks flight. Low-resolution textures swap to high resolution with a short crossfade. The opening fade from black is the only loading screen. A `manifest.json` lists each asset per tier, with its size and priority.

## 13. Audio and music

**Layers.**

| Layer | Content | Behavior |
|---|---|---|
| Base | Low drone | Always on. (Synthesized wind that rose with speed was cut at launch: it sounded like machinery.) |
| Music box | Slow D-minor melody | Global. Varies across loops. |
| Bell | Distant toll every about 24 s | Global, heavy reverb |
| Hall choir | Wordless "ah" pad | Gain by distance to the hall; fullest inside |
| Gate | Chains, low strings, crackle | Zone around the courtyard |
| Heights | Sparse high notes | Above about 100 m |
| Events | Dragon roar with fire, whoosh through walls, distant caw | Triggered, attenuated by distance |

**Implementation.**
- Web Audio with one master bus, a compressor and a shared convolution reverb.
- Zones are spheres or boxes in `data/zones.json`, each with a falloff and a target gain.
- In production, replace the mockup's synthesized layers with composed stems. All stems share key and tempo (D minor, free time or about 60 BPM) so crossfades never clash.
- Stems are Opus with AAC fallbacks, 96–128 kbps, loops of 60–120 s, streamed and decoded on demand.
- Mute is remembered per device in local storage.

## 14. UI and controls

**HUD.**
- Title placard top left; fades after the first interaction in production.
- A status pill bottom left: Autofly / Free flight · "returns in N s" / Inside the great hall / Passing through stone.
- Buttons: Autofly (F), Sound (M), Controls (H). A Controls panel lists the bindings.

**Desktop.** Drag to look, WASD to move, Space/E to rise, Q/C to sink, Shift to boost, wheel to zoom. Add optional pointer lock.

**Touch.** A floating left stick appears where you press, drag on the right side looks, ▲ ▼ buttons rise and sink, and pinch zooms. Portrait gets a wider FOV and a farther camera.

**Gamepad (v1.1).** Left stick moves, right stick looks, triggers rise and sink, A toggles autofly.

**Accessibility.**
- Respect `prefers-reduced-motion`: no bob, no grain, a softer phase effect, and slower autofly turns.
- Every control is reachable by keyboard with visible focus.
- The status pill is a live region.
- No flashing above 3 Hz. The fire flicker must stay under this.

**Fallback.** If WebGL is unavailable, show a clear message.

## 15. Tech stack and repo layout

- Vite and TypeScript, with ES modules.
- Current three.js from npm, pinned.
- Post-processing with three's composer and an output pass, or the pmndrs `postprocessing` library. Choose during M0.
- glTF-Transform and KTX-Software for the asset pipeline.
- Static deploy to GitHub Pages or Cloudflare Pages.

```
hollowmere/
  index.html
  src/
    main.ts               boot, tier detection, loop
    render/               renderer, post pipeline, quality tiers
    world/                terrain, cliff, castle kit + assembly, water, sky, mist
    flight/               ghost body, flight model, camera, autofly
    life/                 dragon, bats, ghosts, pumpkins, candles, boat, wisps
    audio/                engine, zones, stems
    ui/                   HUD, controls panel, touch controls
    data/                 loaders + types for the JSON below
  data/  world.json  route.json  zones.json
  public/assets/          processed, compressed assets + manifest.json
  prompts/                image prompts (YAML)
  tools/                  generate.ts, process.ts, validate.ts
  docs/  design.md  mockup/hollowmere-mockup.html
```

A dev-only `validate` step checks every geometry for NaN or Infinity before upload. A single NaN vertex in the mockup's ghost mesh made the bloom pass smear black blocks across the whole screen.

## 16. Open questions

1. **Castle geometry source.** A procedural kit in code is easy for contributors to change through data. Blender glTF pieces give better silhouettes and UVs. A likely answer is a Blender kit placed by data.
2. ~~**Licenses.**~~ Decided at launch: MIT for everything, code, art and music. OpenAI's terms assign output rights to the user, so generated textures can ship under it too.
3. **Interiors beyond the hall.** For example a crypt under the keep, or a spiral stair inside a west tower.
4. **WebGPU renderer.** It is possible later through three's WebGPU backend. WebGL2 is the v1 baseline.

## 17. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Port the mockup to Vite + TS modules, driven by data files | Visual parity with the mockup; world, route and zones load from JSON |
| M1 | Flight, camera and dev tools | Route editor, free camera, stats overlay, geometry validation |
| M2 | Castle kit v1 plus first generated textures | Real meshes for tower, wall, hall, viaduct and gate; stone, slate and window atlases in KTX2 |
| M3 | Look pass | Soft-particle mist, water upgrade, tuned light and grade; side-by-side check against the reference painting |
| M4 | Life | Skinned dragon, better trees, the Lantern Warden, NPC ghost behaviors |
| M5 | Audio | Composed stems, zones, events, mute memory |
| M6 | Streaming and tiers | Under 3 s to interactive, quality tiers, mobile pass |
| M7 | Launch | README, licenses, credits, accessibility check, deploy |

**Halloween cut (by 31 October).** M0, M1, a lighter M2 (textures on the existing primitive kit), M3, and the M5 basics (the mockup's synth layers plus two composed stems). The skinned dragon, the full castle kit and the gamepad move to after Halloween.

## 18. What the mockup proved

- Primitives plus fog, warm emissive windows, a cold moon key light and bloom already read as the painting at a distance. The 3D bet holds.
- The opening composition works only because autofly biases its look toward the castle when far away. Keep that rule.
- Flying through the stained glass into the candle-lit hall is the signature moment. Protect it in every milestone.
- Close up, procedural textures look like a game (brick-like stone, blob trees). That is where the art budget goes.
- Bugs worth remembering:
  - A NaN in a mesh produced screen-wide bloom artifacts.
  - Mist billboards sliced into the water.
  - Too much emissive bloomed into white mush.
  - Blue-tinted stone turned pink under warm light.
  - Portrait screens needed their own camera framing.

## 19. Things the first draft left out

**Small interactions.** The per-creature "reacts to you" entries above, plus: lanterns flicker when you pass through, banners stir, the hall choir swells for a beat when you cross the glass. These are cheap and they're the difference between a diorama and a place. Each should be a short, local, non-blocking response.

**Screenshot mode.** This is a mood piece, so screenshots are how it spreads. One key (P) hides the HUD, renders at 2× resolution with the ghost still in frame, and offers the PNG. Also an "H to hide everything" mode for people using it as a wallpaper.

**Tab visibility and battery.** Pause the render loop and audio when the tab is hidden. Drop to the low tier on battery when the API reports it. Cap at 30 fps when the window has been unfocused for a minute.

**Deep links.** `?at=hall`, `?at=gate`, `?at=keep` start you at a named route point, and `?autofly=0` starts in free flight. Named points live in `route.json`.

**Weather and sky events.** The moon never moves. But every few minutes something small happens: a shooting star, a cloud crossing the moon and dimming the world for ten seconds, a far-off lightning flash behind the mountains with thunder six seconds later. One per 2–4 minutes, never two at once.

**Lore, lightly.** Names for things help contributors and give the HUD something to say when you enter a zone: the Mere (the lake), the Hollow Hall, the Warden's Gate, the Candle Stair, Wyrmspire. A paragraph of backstory in the README, no more. Nothing is explained in-app.

**Reference images.** The mood-board paintings are references only. Their provenance is unknown, so they do not go in the repo. §3a describes what each lends; keep the files privately.

**Scale check.** The ghost is 2.6 m, hall windows 24 m, keep 166 m. Everything new is placed against those three numbers so a door is never ghost-sized by accident.

**Testing.**
- Screenshot regression: render six fixed route points on every PR in headless Chromium (SwiftShader, as the mockup was checked) and diff against baselines.
- Geometry validation on every asset: no NaN, no Infinity, bounds within the world, triangle counts under budget.
- Route validation: the autofly curve must not pass through solids except where a waypoint is marked `through: true` (the hall glass).
- A perf smoke test: 10 s along the route under 300 draw calls and 1.5 M triangles at every tier.

**Compatibility.** WebGL2 is required. Safari on iOS 16+, Chrome and Firefox on desktop and Android for the last two years. iOS Safari needs: a user gesture before audio, a cap on texture size (2K at low tier), and no half-float MSAA target on older GPUs (fall back to no MSAA). Test on a real low-end Android early; it is where the budget breaks first.

**Sharing metadata.** OG image (a screenshot of the opening shot), favicon, a one-line description, and a `<noscript>` message.

**Credits.** In-app credits panel listing code, the generated art and its provider, the music and its composer, and the fonts, each with its license. The license mix is open (§16).

**Privacy.** No analytics, no network calls after assets load, no cookies. Say so in the README and the credits panel. The one local-storage key is the mute setting.

**Contributing.** A `CONTRIBUTING.md` with three recipes: add a point of interest (edit `world.json`, add a waypoint, add a zone), add a creature (the five entries from §10 plus a budget), and add a texture (prompt file, process, commit). Plus the original-IP rule stated plainly.
