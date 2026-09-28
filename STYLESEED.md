# StyleSeed — Unwind Design Lock

승인된 `docs/PRODUCT_UX_IMPROVEMENT_PLAN.md`의 모바일 읽기 경험을 구현한다. 기존 브랜드를 유지하고 다른 브랜드를 복제하지 않는다.

- App domain: content
- Surface: mobile-app
- Surface adapter: product-ui
- Page type: detail
- Output grammar: editorial-reading
- Grammar path: built-in:engine/RULESETS.md
- Grammar fallback: editorial-reading
- Reference confidence: n/a
- Brand recipe: native-mobile
- Palette recipe: editorial-ink
- Key color: #0075de
- Palette character: calm
- Palette mode: light
- Palette harmony: tonal
- Surface temperature: warm
- Aesthetic profile: none
- Skin: custom
- Primary action: #0075de
- Font: system sans-serif, Korean first, native font scaling
- Radius: soft
- Elevation: restrained hairline, no nested document cards
- Density: comfortable
- Motion: Spring restrained
- Imagery/data role: text first, source context second
- Signature move: one readable Markdown document with a clear opening claim
- Locked: 2026-09-29

## Product bounds

- Detail: source/date, title once, introduction, complete Markdown in source order. No V1 fallback and no fixed point count.
- Home/list: same-document plain-text preview, no duplicated article across sections, secondary status only when needed.
- Existing `#0075de` brand remains; body and metadata contrast must pass the 4.5:1 target.
- Body 16/27, title 24–28, section 18–22; Korean copy and readable paragraph spacing.
- Minimum action area 44×44, primary controls 48; 200% native scaling without fixed-height clipping.
- Ionicons family only. No decorative image generation, WebView or remote fonts.
- Product-specific component tests and 320px visual verification take precedence over web-only scaffold checks.
