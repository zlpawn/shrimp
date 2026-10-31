# CJK 文字适配规则（兜底用）

> 摘自 leo-ppt-agent `svg-generator.md`。适用于兜底出片（PptxGenJS / HTML / SVG）时估算中文字宽、行数与字号，防止文字溢出。PptxGenJS 中以英寸为单位时，先按 1 in = 96 px 换算。

## Dynamic Font Sizing

Instead of fixed font sizes, calculate based on content length to prevent overflow and underutilization:

### Slide Title
```
font_size = clamp(28, 44 - (char_count - 15) * 0.5, 44)
```
- ≤15 characters: 44px (maximum)
- 16-30 characters: scales down linearly
- ≥31 characters: 28px (minimum)

### Card Title
```
font_size = clamp(18, 32 - (char_count - 20) * 0.7, 32)
```
- ≤20 characters: 32px
- 21-40 characters: scales down
- ≥40 characters: 18px (minimum)

### CJK Adjustment
For text containing >30% CJK characters, multiply `char_count` by 1.8 before applying the formula (CJK characters are ~1.8x wider than Latin at same font size).

### Example
- Title "Q3 Revenue" (10 chars Latin) → 44px
- Title "综合分析全球供应链中断的影响" (14 CJK chars × 1.8 = 25.2 effective) → 44 - (25.2-15)*0.5 = 38.9 → 39px
- Title "Comprehensive Analysis of Global Supply Chain Disruptions" (58 chars) → 28px (minimum)

## CJK Text Handling

When generating slides containing CJK (Chinese, Japanese, Korean) text, apply these rules:

### Character Width

CJK characters are approximately **1.8x wider** than Latin characters at the same font-size. Adjust text wrapping calculations accordingly:

- **Latin line capacity**: `card_width / (font_size * 0.6)` characters per line
- **CJK line capacity**: `card_width / (font_size * 1.1)` characters per line

### Line Height

Increase line height by **+20%** for CJK text readability:

- Body text: use `dy="30"` instead of `dy="24"`
- Bullet points: use `dy="34"` instead of `dy="28"`

### Font Family

The `font-family` chain **MUST** include CJK fonts from the style YAML's `cjk_font` token. Place CJK fonts after Latin fonts but before the generic fallback:

```xml
<text font-family="Inter, 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif">
```

### Emphasis

Use **bold weight** for emphasis in CJK text, **NOT italic**. CJK italic rendering is typographically poor and reduces readability.

### Character Spacing

Use default tracking for CJK body text. **Never** add positive `letter-spacing` to CJK body text — it breaks the natural reading rhythm of ideographic characters.

### Punctuation Rules

- No line should **start** with closing punctuation: `。` `、` `」` `』` `）` `】`
- No line should **end** with opening punctuation: `「` `『` `（` `【`

When wrapping CJK text into `<tspan>` elements, check line boundaries against these punctuation rules and adjust breaks accordingly.

## Text Overflow Strategy

SVG does not auto-wrap or auto-shrink text. Prevent overflow with these rules:

### Line Capacity Estimation
- Latin text: `line_capacity = card_width / (font_size * 0.6)` characters per line
- CJK text: `line_capacity = card_width / (font_size * 1.1)` characters per line
- Mixed text: use the more conservative (CJK) estimate

### Overflow Prevention (in order)
1. **Reduce font size**: if text exceeds card height, reduce by 2px steps (minimum: 14px body, 18px card title)
2. **Truncate with ellipsis**: if still overflowing at minimum font, truncate with "..."
3. **Split to multiple cards**: if content is too long for any single card, split into separate cards

### Hard Rules
- Text MUST NOT extend beyond card boundary rectangles
- Body text minimum: 14px (12px for labels/footnotes only)
- Card title minimum: 18px
- Always leave 24px padding inside cards before text starts
- Maximum lines per card: estimate as `(card_height - 80) / (font_size * line_height_factor)`
  - line_height_factor: 1.4 for Latin, 1.7 for CJK
