from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageTemplate, Paragraph, Spacer, Table, TableStyle)

OUT = '../documentation/openscope-command-cheat-sheet.pdf'  # run from tools/: python3 make-command-cheat-sheet.py
FONT_DIR = '/usr/share/fonts/truetype/dejavu/'
pdfmetrics.registerFont(TTFont('Sans', FONT_DIR + 'DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('Sans-Bold', FONT_DIR + 'DejaVuSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('Mono', FONT_DIR + 'DejaVuSansMono.ttf'))
pdfmetrics.registerFont(TTFont('Mono-Bold', FONT_DIR + 'DejaVuSansMono-Bold.ttf'))
pdfmetrics.registerFontFamily('Sans', normal='Sans', bold='Sans-Bold', italic='Sans', boldItalic='Sans-Bold')
pdfmetrics.registerFontFamily('Mono', normal='Mono', bold='Mono-Bold', italic='Mono', boldItalic='Mono-Bold')

INK = colors.HexColor('#1b2733')
ACCENT = colors.HexColor('#1f5f8b')
MUTED = colors.HexColor('#5b6b7a')
RULE = colors.HexColor('#c9d3dc')
BAND = colors.HexColor('#eef3f7')
CODE = colors.HexColor('#0b5d3b')

body = ParagraphStyle('body', fontName='Sans', fontSize=8.6, leading=11.6, textColor=INK)
small = ParagraphStyle('small', parent=body, fontSize=7.8, leading=10.4, textColor=MUTED)
cell = ParagraphStyle('cell', parent=body, fontSize=8, leading=10.4)
code = ParagraphStyle('code', parent=cell, fontName='Mono', fontSize=7.6, leading=10.4, textColor=CODE)
head = ParagraphStyle('head', parent=body, fontName='Sans-Bold', fontSize=7.6, textColor=colors.white)
title = ParagraphStyle('title', parent=body, fontName='Sans-Bold', fontSize=20, leading=24, textColor=ACCENT)
sub = ParagraphStyle('sub', parent=body, fontSize=9.4, leading=13, textColor=MUTED)
h1 = ParagraphStyle('h1', parent=body, fontName='Sans-Bold', fontSize=12, leading=15, textColor=ACCENT, spaceBefore=9, spaceAfter=3)
step = ParagraphStyle('step', parent=body, leftIndent=12, bulletIndent=0, spaceAfter=2.5)

W = A4[0] - 28 * mm


def p(text, style=cell):
    return Paragraph(text, style)


def table(rows, widths, header):
    data = [[p(h, head) for h in header]]
    for row in rows:
        data.append([p(row[0], code), p(row[1], code)] + [p(c) for c in row[2:]] if len(header) == 4 else
                    [p(row[0], code), p(row[1])])
    t = Table(data, colWidths=widths, repeatRows=1)
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), ACCENT),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('LINEBELOW', (0, 1), (-1, -1), 0.4, RULE),
    ]
    for i in range(2, len(data), 2):
        style.append(('BACKGROUND', (0, i), (-1, i), BAND))
    t.setStyle(TableStyle(style))

    return t


def commands(rows):
    # name | type this | what it does
    data = [[p('Command', head), p('Type', head), p('What it does', head)]]
    for name, typed, note in rows:
        data.append([p(name, ParagraphStyle('n', parent=cell, fontName='Sans-Bold')), p(typed, code), p(note)])
    t = Table(data, colWidths=[33 * mm, 52 * mm, W - 85 * mm], repeatRows=1)
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), ACCENT),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('LINEBELOW', (0, 1), (-1, -1), 0.4, RULE),
    ]
    for i in range(2, len(data), 2):
        style.append(('BACKGROUND', (0, i), (-1, i), BAND))
    t.setStyle(TableStyle(style))

    return t


def section(name, intro, rows):
    parts = [Paragraph(name, h1)]

    if intro:
        parts.append(Paragraph(intro, small))
        parts.append(Spacer(1, 3))

    parts.append(commands(rows))

    # keep a heading with its table, and small tables on one page
    return [KeepTogether(parts)]


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Sans', 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(14 * mm, 8 * mm, 'openScope command cheat sheet - altitudes are in hundreds of feet - AAL123 stands for any callsign')
    canvas.drawRightString(A4[0] - 14 * mm, 8 * mm, 'Page %d' % doc.page)
    canvas.restoreState()


doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=13 * mm, bottomMargin=14 * mm,
                      title='openScope command cheat sheet', author='openScope', subject='How to play and every command')
doc.addPageTemplates([PageTemplate(id='main', frames=[Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f', leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=footer)])

s = []
s.append(Paragraph('openScope: how to play and every command', title))
s.append(Paragraph('You are the approach and departure controller. Aircraft appear on the radar and as strips on the right. '
                   'You give them instructions; they read them back and fly them.', sub))

s.append(Paragraph('Play in two minutes', h1))
for n, text in enumerate([
    '<b>Start:</b> <font name="Mono">npm run build</font> then <font name="Mono">npm run start</font>, open <font name="Mono">http://localhost:3003</font>. '
    'Pick an airport with the airport button (search by city, IATA code or country). Press <b>F8</b> any time for the in-game controls guide.',
    '<b>Select an aircraft:</b> click it or its strip, or use PageUp / PageDown. The side panel shows squawk, route, QNH, fuel and souls on board. '
    'The command bar fills in its callsign.',
    '<b>Departures:</b> <font name="Mono">caf</font> (cleared as filed), <font name="Mono">taxi 27R</font>, <font name="Mono">cvs</font> (climb via SID), '
    '<font name="Mono">cto</font> (cleared for takeoff). Then vector, climb and route direct.',
    '<b>Arrivals:</b> <font name="Mono">dvs</font> or altitude and speed steps (<font name="Mono">d 80</font>, <font name="Mono">sp 210</font>), '
    '<font name="Mono">e 27R</font> (expect runway), vector onto the centreline, <font name="Mono">i 27R</font> (cleared ILS). '
    'Keep them separated and landing; a go-around is <font name="Mono">ga</font>.',
    '<b>Type or talk:</b> <b>F4</b> opens the radio. Type a sentence ("Speedbird one two three, descend flight level eight zero") or hold <b>Right Shift</b> and speak. '
    'With a Claude key it understands anything you say; without one it understands standard phraseology.',
    '<b>Watch for trouble:</b> low fuel, MAYDAY (squawk 7700), radio failure (7600), medical and technical problems. Ask <font name="Mono">sf</font> for fuel, '
    'send them <font name="Mono">divert EGCC</font>, answer requests with <font name="Mono">roger</font> or <font name="Mono">unable</font>. '
    'Frequency is set in Settings (Failures and emergencies).',
    '<b>Keep the ATIS current</b> (F3). Pilots quote the information letter they last heard.',
], 1):
    s.append(Paragraph(text, ParagraphStyle('st', parent=step, bulletFontName='Sans-Bold'), bulletText='%d.' % n))

s.append(Paragraph('Keys and mouse', h1))
keys = [
    ['Click aircraft / PageUp, PageDown, up, down', 'Select an aircraft (up/down also select unless Settings > Control Method = Arrow Keys)'],
    ['Tab', 'Search and autocomplete commands'],
    ['Esc', 'Close dialogs, then deselect'],
    ['F1 / F2', 'Shorten / lengthen the predicted track line'],
    ['F3', 'ATIS: update, edit, read aloud, AI-suggested remarks'],
    ['F4', 'Radio panel: type or speak to pilots'],
    ['Right Shift (hold)', 'Push to talk, from anywhere'],
    ['F8', 'Controls guide'],
    ['Numpad / * + -', 'Insert takeoff, ILS, speed up, speed down'],
    ['Arrow keys (Control Method = Arrow Keys)', 'left / right insert a turn, up / down insert climb / descend'],
    ['` (backquote)', 'Switch between aircraft commands and scope commands'],
    ['Mouse wheel / drag', 'Zoom / pan the scope'],
]
kt = Table([[p(a, ParagraphStyle('k', parent=cell, fontName='Sans-Bold')), p(b)] for a, b in keys], colWidths=[62 * mm, W - 62 * mm])
kt.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('TOPPADDING', (0, 0), (-1, -1), 2.2), ('BOTTOMPADDING', (0, 0), (-1, -1), 2.2),
                        ('LINEBELOW', (0, 0), (-1, -1), 0.4, RULE), ('LEFTPADDING', (0, 0), (-1, -1), 4)]))
s.append(kt)

s.append(Paragraph('Hundreds of feet: <font name="Mono">d 30</font> = descend to 3,000 ft; above the transition altitude the same number is a flight level '
                   '(<font name="Mono">c 120</font> = FL120). Headings are three digits (<font name="Mono">090</font>); one or two digits after a direction mean degrees to turn '
                   '(<font name="Mono">t l 20</font> = turn left 20 degrees). Runways are written like <font name="Mono">27R</font> or <font name="Mono">09L</font>. '
                   'Commands can be chained: <font name="Mono">BAW123 t l 270 d 40 sp 210</font>.', small))

s.append(Paragraph('Aircraft commands', ParagraphStyle('t2', parent=title, fontSize=15, leading=19, spaceBefore=14)))
s.append(Paragraph('Every command starts with the aircraft: <font name="Mono">AAL123 &lt;command&gt;</font>. Several commands can follow one callsign. '
                   'Shorter aliases are shown first.', small))

s += section('Departures', 'Used by aircraft on the ground.', [
    ['Cleared as filed', 'AAL123 caf', 'Accept the filed flight plan and SID. Normal first step for a departure.'],
    ['SID', 'AAL123 sid [name]', 'Clear them via a different SID.'],
    ['Taxi / hold short', 'AAL123 taxi [runway]', 'Taxi to and hold short of the runway. Aliases: w, wait.'],
    ['Climb via SID', 'AAL123 cvs  |  cvs [alt]', 'Climb following the SID restrictions, optionally to an altitude.'],
    ['Takeoff', 'AAL123 cto', 'Cleared for takeoff (numpad /). Aliases: to, takeoff. Without a SID, cvs or an assigned altitude the pilot asks for one first.'],
])
s += section('Arrivals', 'Used by aircraft inbound to the airport.', [
    ['Expect runway', 'AAL123 e [runway]', 'Tell them which runway to plan for (also selects the right STAR branch).'],
    ['Descend via STAR', 'AAL123 dvs  |  dvs [alt]', 'Descend following the STAR restrictions, optionally to an altitude.'],
    ['ILS approach', 'AAL123 i [runway]', 'Cleared ILS (numpad *). Aliases: ils, *. They intercept the localizer and glideslope, land and leave frequency.'],
    ['Go around', 'AAL123 ga', 'Break off the approach: climb on runway heading to a safe altitude and wait. Aliases: goaround, missed.'],
    ['Divert', 'AAL123 divert [ICAO]', 'Divert to any airport in the airport index. The pilot checks fuel and runway length first. Alias: dvt.'],
])
s += section('Heading, altitude, speed', 'The basic instructions.', [
    ['Heading (turn)', 'AAL123 t l|r [hdg]  |  fh [hdg]', 'Turn left/right to a heading; fh takes the short way. Aliases: h, heading, turn, t.'],
    ['Turn by degrees', 'AAL123 t l|r [deg]', 'One or two digits means degrees to turn, not a heading: t r 20.'],
    ['Fly present heading', 'AAL123 fph', 'Cancel a turn. Before takeoff: fly runway heading.'],
    ['Altitude', 'AAL123 c|d [alt]  |  c [alt] ex', 'Climb or descend (hundreds of ft; add ex to expedite). Aliases: a, altitude, climb, descend.'],
    ['Speed', 'AAL123 sp [kt]  |  + [kt]  |  - [kt]', 'Assign a speed in knots. Aliases: speed, slow. They refuse (unable) outside their envelope.'],
])
s += section('Routing', 'Change where an aircraft is going.', [
    ['Proceed direct', 'AAL123 pd [fix]', 'Fly direct to a fix. Aliases: dct, direct.'],
    ['Hold', 'AAL123 hold [fix] [l|r] [n]min|[n]nm [radial]', 'Hold at a fix, e.g. hold DET l 2min.'],
    ['Exit hold', 'AAL123 xh  |  xh [fix]', 'Leave the holding pattern (immediately, or at a fix). Aliases: continue, exithold, cancelhold, nohold.'],
    ['Route', 'AAL123 route [route]', 'Insert a route that rejoins the current one, e.g. route FESKO..RUFUS..CHOIR (shortcuts, extensions). Single dots join procedures and airways, double dots fix to fix.'],
    ['Reroute', 'AAL123 rr [route]', 'Replace the whole route. Alias: reroute.'],
    ['STAR', 'AAL123 star [transition].[name].[ICAO]', 'Change the arrival procedure.'],
    ['Cross', 'AAL123 x [fix] a[alt] s[kt]', 'Cross a fix at an altitude and/or speed. Aliases: cross, cr.'],
])
s += section('Questions to the pilot', 'The pilot answers with exact figures from the simulation.', [
    ['Say fuel', 'AAL123 sf', 'Endurance and quantity; says if minimum fuel or fuel emergency. Alias: fuel.'],
    ['Say persons on board', 'AAL123 sob', 'Souls on board. Aliases: souls, pob.'],
    ['Say intentions', 'AAL123 sint', 'Repeats what the pilot has asked for. Alias: intentions.'],
    ['Say information', 'AAL123 sinfo', 'The ATIS letter they hold. Alias: atisletter.'],
    ['Say altitude / assigned', 'AAL123 sa  |  saa', 'Current altitude / altitude you assigned.'],
    ['Say heading / assigned', 'AAL123 sh  |  sah', 'Current heading / heading you assigned.'],
    ['Say speed / assigned', 'AAL123 si  |  sas', 'Indicated airspeed / speed you assigned.'],
])
s += section('Miscellaneous', None, [
    ['Squawk', 'AAL123 sq [code]', 'Set the transponder code, e.g. sq 4521. Emergencies squawk 7700 (7600 radio failure).'],
    ['Roger', 'AAL123 roger', 'Acknowledge a call or request. Does not grant it: give the instruction (e.g. pd FIX). Alias: rgr.'],
    ['Unable', 'AAL123 unable', 'Turn a request down; the pilot carries on as planned. Alias: deny.'],
])
s += section('System commands', 'Typed without a callsign.', [
    ['Airport', 'airport [ICAO]', 'Switch to another airport, e.g. airport EGGP.'],
    ['Pause', 'pause', 'Pause the simulation; click to resume.'],
    ['Timewarp', 'tw [rate]  |  timewarp [rate]', 'Speed up time (1 = normal; any value of 1 or more).'],
    ['Tutorial', 'tutorial', 'Open the tutorial.'],
])
s += section('Scope commands (backquote to switch)', 'Affect the radar display, not aircraft.', [
    ['Move data block', '[dir] [callsign]  |  [dir]/[len] [callsign]', 'Dir is a numpad position (8 up, 2 down, 5 centred); len 0-6 is the leader line length.'],
    ['Scratchpad', '[text] [callsign]', 'Write 2-3 characters in an aircraft\'s data block; a full stop resets it.'],
    ['Toggle halo', 'QP_J [callsign]  |  QP_J [nm] [callsign]', 'Show or hide a halo (default 3 nm) around an aircraft. F7 inserts QP_J.'],
])

s.append(Paragraph('Talk to the pilots (F4)', h1))
phr = [
    ['"Speedbird one two three, turn left heading two seven zero"', 'BAW123 t l 270'],
    ['"Easy six four alpha, descend flight level eight zero, reduce speed two one zero"', 'EZY64A d 80 sp 210'],
    ['"Ryanair seven eight bravo, cleared ILS runway two seven right"', 'RYR78B i 27R'],
    ['"Shamrock four two one, say fuel remaining" (or: how much fuel do you have)', 'EIN421 sf'],
    ['"Speedbird one two three, go around"', 'BAW123 ga'],
    ['"Speedbird one two three, divert to Manchester"', 'BAW123 divert EGCC'],
]
pt = Table([[p(a), p(b, code)] for a, b in phr], colWidths=[W - 52 * mm, 52 * mm])
pt.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('TOPPADDING', (0, 0), (-1, -1), 2.4), ('BOTTOMPADDING', (0, 0), (-1, -1), 2.4),
                        ('LINEBELOW', (0, 0), (-1, -1), 0.4, RULE), ('LEFTPADDING', (0, 0), (-1, -1), 4)]))
s.append(pt)
s.append(Spacer(1, 4))
s.append(Paragraph('Say the callsign first (airline name and number, or select the aircraft). Numbers are spoken digit by digit ("two seven zero", "niner"). '
                   'Any sentence typed in the command bar that is not a command goes to the radio. For free-form speech and pilot voices add '
                   '<font name="Mono">ANTHROPIC_API_KEY</font> and <font name="Mono">ELEVENLABS_API_KEY</font> to a <font name="Mono">.env</font> file, '
                   'or paste them in the AI &amp; Voice dialog (the cog in the radio panel). Turn on the speaker button in the footer to hear the pilots.', small))

doc.build(s)
print('wrote', OUT)
