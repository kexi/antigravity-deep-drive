# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pillow>=10.0.0",
# ]
# ///
"""
Generate high-quality English Open Graph preview image (1200x630) for Antigravity Deep Drive.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def create_og_image():
    width = 1200
    height = 630
    
    scratch_dir = Path("/Users/kei/.gemini/antigravity/brain/4d1fc7bb-363c-4ee7-8320-b8c1514f3295/scratch")
    bg_path = scratch_dir / "raw_og_capture.png"
    pip_path = scratch_dir / "raw_og_chase_sunset.png"
    output_path = Path("/Users/kei/ghq/github.com/kexi/antigravity-deep-drive/apps/web/public/og-image.png")
    
    # 1. Base background: Cockpit sunset view
    bg_img = Image.open(bg_path).convert("RGBA")
    # Resize and crop to 1200x630
    bg_ratio = bg_img.width / bg_img.height
    target_ratio = width / height
    
    if bg_ratio > target_ratio:
        new_height = height
        new_width = int(height * bg_ratio)
    else:
        new_width = width
        new_height = int(width / bg_ratio)
        
    bg_resized = bg_img.resize((new_width, new_height), Image.Resampling.LANCZOS)
    left = (new_width - width) // 2
    top = (new_height - height) // 2
    canvas = bg_resized.crop((left, top, left + width, top + height))
    
    # 2. Add subtle dark gradient overlay on top & bottom for legibility
    gradient = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    g_draw = ImageDraw.Draw(gradient)
    
    # Top header gradient (dark blue/black)
    for y in range(240):
        alpha = int(220 * (1.0 - (y / 240) ** 1.2))
        g_draw.line([(0, y), (width, y)], fill=(5, 8, 17, alpha))
        
    # Bottom footer gradient
    for y in range(height - 180, height):
        progress = (y - (height - 180)) / 180
        alpha = int(230 * (progress ** 1.1))
        g_draw.line([(0, y), (width, y)], fill=(5, 8, 17, alpha))
        
    # Left side vignette gradient
    for x in range(450):
        progress = 1.0 - (x / 450)
        alpha = int(140 * (progress ** 1.3))
        g_draw.line([(x, 0), (x, height)], fill=(5, 8, 17, alpha))
        
    canvas = Image.alpha_composite(canvas, gradient)
    
    # 3. PiP Chase Camera Card in top-right
    if pip_path.exists():
        pip_w = 340
        pip_h = 190
        pip_x = width - pip_w - 40
        pip_y = 40
        
        pip_raw = Image.open(pip_path).convert("RGBA")
        pip_resized = pip_raw.resize((pip_w, pip_h), Image.Resampling.LANCZOS)
        
        # Create rounded mask for PiP
        mask = Image.new("L", (pip_w, pip_h), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.rounded_rectangle([(0, 0), (pip_w - 1, pip_h - 1)], radius=12, fill=255)
        
        # Outer glow/shadow for PiP
        shadow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        s_draw = ImageDraw.Draw(shadow)
        s_draw.rounded_rectangle(
            [(pip_x - 3, pip_y - 3), (pip_x + pip_w + 3, pip_y + pip_h + 3)],
            radius=14,
            fill=(56, 189, 248, 80)  # Cyan glow
        )
        shadow = shadow.filter(ImageFilter.GaussianBlur(6))
        canvas = Image.alpha_composite(canvas, shadow)
        
        # Paste PiP image
        canvas.paste(pip_resized, (pip_x, pip_y), mask)
        
        # Border and label for PiP
        overlay_pip = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        op_draw = ImageDraw.Draw(overlay_pip)
        op_draw.rounded_rectangle(
            [(pip_x, pip_y), (pip_x + pip_w - 1, pip_y + pip_h - 1)],
            radius=12,
            outline=(56, 189, 248, 220),
            width=2
        )
        # Small header pill on PiP
        try:
            pip_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 11)
        except Exception:
            pip_font = ImageFont.load_default()
            
        badge_w, badge_h = 140, 22
        op_draw.rounded_rectangle(
            [(pip_x + 10, pip_y + 10), (pip_x + 10 + badge_w, pip_y + 10 + badge_h)],
            radius=6,
            fill=(15, 23, 42, 220),
            outline=(56, 189, 248, 160),
            width=1
        )
        op_draw.text((pip_x + 18, pip_y + 14), "CHASE CAMERA VIEW", font=pip_font, fill=(56, 189, 248, 255))
        canvas = Image.alpha_composite(canvas, overlay_pip)

    # 4. Typography and Badges
    text_overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(text_overlay)
    
    # Fonts
    try:
        font_title = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 46)
        font_sub = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 22)
        font_badge = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 13)
        font_tag = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 13)
        font_url = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 15)
    except Exception:
        font_title = font_sub = font_badge = font_tag = font_url = ImageFont.load_default()

    # Category Pill Badge (Top Left)
    bx, by = 48, 42
    badge_text = "WEBGL 3D DRIVING SIMULATOR"
    d.rounded_rectangle([(bx, by), (bx + 250, by + 28)], radius=14, fill=(15, 23, 42, 230), outline=(56, 189, 248, 200), width=1)
    # glowing cyan dot
    d.ellipse([(bx + 12, by + 9), (bx + 22, by + 19)], fill=(56, 189, 248, 255))
    d.text((bx + 28, by + 6), badge_text, font=font_badge, fill=(56, 189, 248, 255))

    # Main Title
    tx, ty = 48, 82
    d.text((tx, ty), "ANTIGRAVITY DEEP DRIVE", font=font_title, fill=(255, 255, 255, 255))
    
    # Subtitle
    sx, sy = 48, 142
    d.text((sx, sy), "Realistic Tokyo Station & Shibuya 3D Driving Experience", font=font_sub, fill=(226, 232, 240, 240))

    # Feature tags (Bottom Left)
    tags = [
        "Three.js & WebGL",
        "PLATEAU 3D City",
        "JDM Right-Hand Drive",
        "Procedural Facades",
        "Weather & Time"
    ]
    
    cur_x = 48
    tag_y = height - 85
    for tag in tags:
        # Measure text width
        bbox = d.textbbox((0, 0), tag, font=font_tag)
        tw = bbox[2] - bbox[0]
        pw = tw + 24
        ph = 32
        d.rounded_rectangle([(cur_x, tag_y), (cur_x + pw, tag_y + ph)], radius=16, fill=(15, 23, 42, 210), outline=(148, 163, 184, 120), width=1)
        d.text((cur_x + 12, tag_y + 8), tag, font=font_tag, fill=(241, 245, 249, 240))
        cur_x += pw + 12

    # Bottom Right Info: URL & Author
    url_text = "kexi.github.io/antigravity-deep-drive"
    author_text = "By @7_tsuno"
    
    url_bbox = d.textbbox((0, 0), url_text, font=font_url)
    author_bbox = d.textbbox((0, 0), author_text, font=font_tag)
    
    rx = width - 48
    d.text((rx - (url_bbox[2] - url_bbox[0]), height - 82), url_text, font=font_url, fill=(56, 189, 248, 240))
    d.text((rx - (author_bbox[2] - author_bbox[0]), height - 58), author_text, font=font_tag, fill=(148, 163, 184, 200))

    canvas = Image.alpha_composite(canvas, text_overlay)
    
    # Save as RGB PNG
    final_img = canvas.convert("RGB")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    final_img.save(output_path, "PNG", optimize=True)
    print(f"Successfully generated {output_path} ({width}x{height})")

if __name__ == "__main__":
    create_og_image()
