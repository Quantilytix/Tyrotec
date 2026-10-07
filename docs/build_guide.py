"""Builds the Tyrotec Portal user guide PDF for the client.

Palette and proportions follow frontend/src/utils/pdfShared.js so this reads
as part of the same family as the quotations and receipts the portal issues.
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import Color
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    KeepTogether, Flowable, PageBreak, Image,
)

OUT = os.path.join(os.path.dirname(__file__), "Tyrotec-Portal-Guide.pdf")
LOGO = r"c:\Users\LEEROY\Desktop\QX Projects\JAMLEA Project\frontend\public\jamlea.jpg"


def rgb(r, g, b):
    return Color(r / 255.0, g / 255.0, b / 255.0)


INK        = rgb(16, 25, 43)
NAVY       = rgb(30, 58, 102)
NAVY_TINT  = rgb(234, 240, 251)
CANVAS     = rgb(245, 246, 248)
GOOD       = rgb(21, 128, 61)
GOOD_TINT  = rgb(240, 253, 244)
AMBER      = rgb(217, 119, 6)
AMBER_TINT = rgb(255, 247, 237)
GRAY       = rgb(100, 116, 139)
BORDER     = rgb(226, 232, 240)
WHITE      = rgb(255, 255, 255)

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm
CONTENT_W = PAGE_W - 2 * MARGIN

S = {
    "title":   ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=26, leading=30, textColor=INK, spaceAfter=6),
    "sub":     ParagraphStyle("sub", fontName="Helvetica", fontSize=12, leading=17, textColor=GRAY),
    "h1":      ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=INK, spaceBefore=4, spaceAfter=7),
    "h2":      ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=NAVY, spaceBefore=11, spaceAfter=4),
    "body":    ParagraphStyle("body", fontName="Helvetica", fontSize=10, leading=15, textColor=INK, alignment=TA_LEFT, spaceAfter=5),
    "small":   ParagraphStyle("small", fontName="Helvetica", fontSize=8.7, leading=12.5, textColor=GRAY),
    "cell":    ParagraphStyle("cell", fontName="Helvetica", fontSize=9.2, leading=13, textColor=INK),
    "cellb":   ParagraphStyle("cellb", fontName="Helvetica-Bold", fontSize=9.2, leading=13, textColor=INK),
    "cellh":   ParagraphStyle("cellh", fontName="Helvetica-Bold", fontSize=8.2, leading=11, textColor=GRAY),
    "step":    ParagraphStyle("step", fontName="Helvetica", fontSize=10, leading=14.5, textColor=INK),
    "stepb":   ParagraphStyle("stepb", fontName="Helvetica-Bold", fontSize=10, leading=14.5, textColor=INK),
    "note":    ParagraphStyle("note", fontName="Helvetica", fontSize=9.3, leading=13.5, textColor=INK),
    "diag":    ParagraphStyle("diag", fontName="Helvetica-Bold", fontSize=8.4, leading=10.5, textColor=INK),
}


# --------------------------------------------------------------------------
# Page furniture
# --------------------------------------------------------------------------
def page_chrome(canvas, doc):
    canvas.saveState()
    # Thin brand rule along the top of every page.
    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_H - 4, PAGE_W, 4, stroke=0, fill=1)

    if doc.page > 1:
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(GRAY)
        canvas.drawString(MARGIN, 12 * mm, "Tyrotec Portal - How the system works")
        canvas.drawRightString(PAGE_W - MARGIN, 12 * mm, "Page %d" % doc.page)
        canvas.setStrokeColor(BORDER)
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN, 15 * mm, PAGE_W - MARGIN, 15 * mm)
    canvas.restoreState()


# --------------------------------------------------------------------------
# Drawing helpers
# --------------------------------------------------------------------------
class Diagram(Flowable):
    """Base for the hand-drawn diagrams; subclasses implement draw()."""

    def __init__(self, width, height):
        Flowable.__init__(self)
        self.width = width
        self.height = height

    def wrap(self, *args):
        return self.width, self.height

    def box(self, x, y, w, h, fill, border, label, sublabel=None,
            label_color=None, radius=4):
        c = self.canv
        c.setFillColor(fill)
        c.setStrokeColor(border)
        c.setLineWidth(1)
        c.roundRect(x, y, w, h, radius, stroke=1, fill=1)
        c.setFillColor(label_color or INK)
        c.setFont("Helvetica-Bold", 8.6)
        if sublabel:
            c.drawCentredString(x + w / 2.0, y + h / 2.0 + 2.5, label)
            c.setFont("Helvetica", 7.4)
            c.setFillColor(GRAY)
            c.drawCentredString(x + w / 2.0, y + h / 2.0 - 7.5, sublabel)
        else:
            c.drawCentredString(x + w / 2.0, y + h / 2.0 - 3, label)

    def arrow(self, x1, y1, x2, y2, color=None, label=None, dashed=False):
        c = self.canv
        col = color or GRAY
        c.setStrokeColor(col)
        c.setLineWidth(1.2)
        if dashed:
            c.setDash(3, 2)
        c.line(x1, y1, x2, y2)
        c.setDash()
        # Arrow head
        import math
        ang = math.atan2(y2 - y1, x2 - x1)
        size = 5
        c.setFillColor(col)
        p = c.beginPath()
        p.moveTo(x2, y2)
        p.lineTo(x2 - size * math.cos(ang - 0.4), y2 - size * math.sin(ang - 0.4))
        p.lineTo(x2 - size * math.cos(ang + 0.4), y2 - size * math.sin(ang + 0.4))
        p.close()
        c.drawPath(p, stroke=0, fill=1)
        if label:
            c.setFont("Helvetica", 7)
            c.setFillColor(GRAY)
            mx, my = (x1 + x2) / 2.0, (y1 + y2) / 2.0
            c.drawCentredString(mx, my + 4, label)


class JourneyDiagram(Diagram):
    """The five steps from browsing to collecting."""

    def __init__(self, width):
        Diagram.__init__(self, width, 108)

    def draw(self):
        c = self.canv
        steps = [
            ("1. Browse", "Customer finds parts", NAVY_TINT, NAVY),
            ("2. Request quote", "Prices confirmed", NAVY_TINT, NAVY),
            ("3. Accept & order", "Stock set aside", AMBER_TINT, AMBER),
            ("4. Pay", "Card, EFT or invoice", AMBER_TINT, AMBER),
            ("5. Collect", "Receipt issued", GOOD_TINT, GOOD),
        ]
        n = len(steps)
        gap = 11
        bw = (self.width - gap * (n - 1)) / float(n)
        bh = 46
        y = 44
        for i, (label, sub, fill, border) in enumerate(steps):
            x = i * (bw + gap)
            self.box(x, y, bw, bh, fill, border, label, sub)
            if i < n - 1:
                self.arrow(x + bw + 1.5, y + bh / 2.0, x + bw + gap - 1.5, y + bh / 2.0, border)

        # Who does what, beneath the row.
        c.setFont("Helvetica-Bold", 7.6)
        c.setFillColor(NAVY)
        c.drawString(0, 26, "The customer does all of this themselves.")
        c.setFillColor(GRAY)
        c.setFont("Helvetica", 7.6)
        c.drawString(0, 13, "Your team only steps in to confirm an offline payment, or when stock runs short.")


class StatusDiagram(Diagram):
    """The six order stages, plus what moves an order between them."""

    def __init__(self, width):
        Diagram.__init__(self, width, 186)

    def draw(self):
        c = self.canv
        w = self.width
        bw, bh = 118, 34

        left = 0
        right = w - bw
        mid = (w - bw) / 2.0

        # Main chain, top to bottom.
        rows = [
            (mid, 148, "Awaiting payment", "Stock is set aside", AMBER_TINT, AMBER),
            (mid, 100, "Paid", "Money received", GOOD_TINT, GOOD),
            (mid, 52, "Ready for collection", "Packed and waiting", GOOD_TINT, GOOD),
            (mid, 4, "Completed", "Customer has it", CANVAS, BORDER),
        ]
        for x, y, label, sub, fill, border in rows:
            self.box(x, y, bw, bh, fill, border, label, sub)

        for y in (148, 100, 52):
            self.arrow(mid + bw / 2.0, y - 2, mid + bw / 2.0, y - 16)

        c.setFont("Helvetica", 7.2)
        c.setFillColor(GRAY)
        c.drawString(mid + bw / 2.0 + 6, 139, "customer pays, or you record a payment")
        c.drawString(mid + bw / 2.0 + 6, 91, "you mark it ready")
        c.drawString(mid + bw / 2.0 + 6, 43, "you mark it collected")

        # The stock-short detour on the left.
        self.box(left, 148, bw, bh, NAVY_TINT, NAVY, "Awaiting approval", "Not enough stock")
        self.arrow(left + bw + 2, 165, mid - 2, 165, NAVY)

        # Cancelled, on the right.
        self.box(right, 100, bw, bh, CANVAS, BORDER, "Cancelled", "Stock goes back")
        self.arrow(mid + bw + 2, 160, right + bw / 2.0, 138, GRAY, dashed=True)

        c.setFont("Helvetica", 7)
        c.setFillColor(GRAY)
        c.drawCentredString(right + bw / 2.0, 92, "if unpaid in time, or you cancel it")


class PaymentDiagram(Diagram):
    """The three ways money can arrive."""

    def __init__(self, width):
        Diagram.__init__(self, width, 136)

    def draw(self):
        c = self.canv
        w = self.width
        bw = (w - 24) / 3.0
        bh = 52

        self.box(0, 66, bw, bh, NAVY_TINT, NAVY, "Card", "Paid online, instantly")
        self.box(bw + 12, 66, bw, bh, NAVY_TINT, NAVY, "Instant EFT", "Paid online, instantly")
        self.box(2 * (bw + 12), 66, bw, bh, AMBER_TINT, AMBER, "Invoice / EFT", "You record it")

        # Everything funnels into one paid order.
        self.box((w - 150) / 2.0, 4, 150, 36, GOOD_TINT, GOOD, "Order marked Paid", "Receipt available to both sides")

        self.arrow(bw / 2.0, 64, (w - 150) / 2.0 + 30, 42, NAVY)
        self.arrow(bw + 12 + bw / 2.0, 64, w / 2.0, 42, NAVY)
        self.arrow(2 * (bw + 12) + bw / 2.0, 64, (w + 150) / 2.0 - 30, 42, AMBER)

        c.setFont("Helvetica", 7.2)
        c.setFillColor(GRAY)
        c.drawString(0, 122, "Automatic - no one on your team has to do anything")
        c.drawRightString(w, 122, "Needs a person to confirm it")


class RolesDiagram(Diagram):
    """Who can see and do what."""

    def __init__(self, width):
        Diagram.__init__(self, width, 152)

    def draw(self):
        c = self.canv
        w = self.width
        tiers = [
            ("Super admin", "Everything, including staff and the activity log", NAVY, WHITE, 96, w),
            ("Admin", "Everything except managing other admins", NAVY_TINT, INK, 52, w * 0.78),
            ("Sales rep", "Products, quotes, orders, customers", CANVAS, INK, 8, w * 0.56),
        ]
        for label, sub, fill, txt, y, bw in tiers:
            c.setFillColor(fill)
            c.setStrokeColor(BORDER if fill is not NAVY else NAVY)
            c.setLineWidth(1)
            c.roundRect(0, y, bw, 36, 4, stroke=1, fill=1)
            c.setFillColor(txt)
            c.setFont("Helvetica-Bold", 9)
            c.drawString(12, y + 21, label)
            c.setFont("Helvetica", 7.6)
            c.setFillColor(rgb(203, 213, 225) if fill is NAVY else GRAY)
            c.drawString(12, y + 9, sub)

        c.setFont("Helvetica", 7.2)
        c.setFillColor(GRAY)
        c.drawString(0, 142, "Each level can do everything the level below it can, plus more")


# --------------------------------------------------------------------------
# Content helpers
# --------------------------------------------------------------------------
def h1(text):
    return Paragraph(text, S["h1"])


def h2(text):
    return Paragraph(text, S["h2"])


def p(text):
    return Paragraph(text, S["body"])


def steps_table(items):
    """Numbered steps, each a bold lead-in plus explanation."""
    rows = []
    for i, (lead, rest) in enumerate(items, start=1):
        num = Paragraph('<font color="#1E3A66"><b>%d</b></font>' % i, S["stepb"])
        body = Paragraph("<b>%s</b>  %s" % (lead, rest), S["step"])
        rows.append([num, body])
    t = Table(rows, colWidths=[12, CONTENT_W - 12])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (0, -1), 0),
        ("LEFTPADDING", (1, 0), (1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


def data_table(headers, rows, widths):
    data = [[Paragraph(h.upper(), S["cellh"]) for h in headers]]
    for r in rows:
        data.append([Paragraph(cell, S["cell"]) for cell in r])
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), CANVAS),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, BORDER),
        ("LINEBELOW", (0, 1), (-1, -2), 0.4, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
    ]))
    return t


def callout(title, body, tone="navy"):
    fill, edge = {"navy": (NAVY_TINT, NAVY), "amber": (AMBER_TINT, AMBER), "good": (GOOD_TINT, GOOD)}[tone]
    inner = [Paragraph("<b>%s</b>" % title, S["note"]), Spacer(1, 3), Paragraph(body, S["note"])]
    t = Table([[inner]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("LINEBEFORE", (0, 0), (0, -1), 3, edge),
        ("BOX", (0, 0), (-1, -1), 0.5, edge),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]))
    return t


# --------------------------------------------------------------------------
# The document
# --------------------------------------------------------------------------
def build():
    doc = BaseDocTemplate(
        OUT, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=20 * mm, bottomMargin=20 * mm,
        title="Tyrotec Portal - How the system works",
        author="Quantilytix",
        subject="User guide for the Tyrotec ordering portal",
    )
    frame = Frame(MARGIN, 20 * mm, CONTENT_W, PAGE_H - 40 * mm, id="body")
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=page_chrome)])

    story = []

    # ---------------- Cover ----------------
    story.append(Spacer(1, 26))
    if os.path.exists(LOGO):
        img = Image(LOGO, width=46 * mm, height=25 * mm, kind="proportional")
        img.hAlign = "LEFT"
        story.append(img)
        story.append(Spacer(1, 18))
    story.append(Paragraph("Tyrotec Portal", S["title"]))
    story.append(Paragraph("How the system works, and how to run it day to day", S["sub"]))
    story.append(Spacer(1, 20))
    story.append(p(
        "This guide explains the Tyrotec online ordering portal in plain language. The first part "
        "covers what your customers see and do. The second part covers what your team does. "
        "Nothing here assumes any technical knowledge."
    ))
    story.append(Spacer(1, 10))
    story.append(callout(
        "In one sentence",
        "Customers build a quote from your catalogue, accept it to create an order, pay by card or "
        "EFT, and collect their parts - and your team sees every step of it as it happens."
    ))
    story.append(Spacer(1, 18))
    story.append(h2("The journey, end to end"))
    story.append(JourneyDiagram(CONTENT_W))
    story.append(Spacer(1, 12))
    story.append(data_table(
        ["What's inside", "Page"],
        [
            ["<b>Part 1 - For your customers</b><br/>Signing up, finding parts, quotes, orders, paying, receipts", "2"],
            ["<b>Part 2 - For your team</b><br/>Products, quotes, orders, payments, customers, staff, reports", "4"],
            ["<b>Part 3 - Reference</b><br/>Order stages, VAT, the 60-minute hold, who to call", "6"],
        ],
        [CONTENT_W - 60, 60],
    ))

    story.append(PageBreak())

    # ---------------- Part 1 ----------------
    story.append(h1("Part 1 &mdash; For your customers"))
    story.append(p(
        "Customers use the portal themselves, on a phone or a computer. They do not need any training "
        "and they do not need to phone you to place an order."
    ))

    story.append(h2("Getting an account"))
    story.append(p(
        "Anyone can create their own account at your portal address. They enter their company name, "
        "email and a password &mdash; or they can simply sign in with their Google account. "
        "New customers can start browsing and ordering immediately."
    ))

    story.append(h2("Finding parts"))
    story.append(steps_table([
        ("Browse or search.", "The full catalogue is available, with a photo, description and price for every part."),
        ("Filter by category.", "Parts are grouped into categories so a customer can narrow down quickly."),
        ("Check availability.", "Each part shows whether it is in stock before anything is added."),
        ("Add to the quote.", "They choose a quantity and add it. They can keep adding parts as they go."),
    ]))

    story.append(h2("Getting a quote"))
    story.append(p(
        "When the customer is happy with their list, they press <b>Request quote</b>. The portal creates "
        "a formal, numbered quotation showing every line, the price excluding VAT, the VAT, and the total. "
        "They can download it as a PDF to send to their buyer or finance department."
    ))
    story.append(callout(
        "Why quotes come first",
        "Every order in the system starts life as a quote. That gives your customer something formal to "
        "approve internally, and gives you a permanent record of exactly what was priced and when.",
        tone="navy",
    ))

    story.append(h2("Turning a quote into an order"))
    story.append(p(
        "When the customer is ready to buy, they open the quote and press <b>Accept &amp; order</b>. "
        "The portal immediately sets that stock aside for them so nobody else can buy it, and creates "
        "a numbered order."
    ))
    story.append(callout(
        "The 60-minute hold",
        "Stock is held for 60 minutes while the customer pays. If payment does not arrive in that time, "
        "the hold is released, the stock goes back on the shelf and the order is cancelled &mdash; but the "
        "quote becomes available again, so the customer can simply accept it a second time.",
        tone="amber",
    ))

    story.append(KeepTogether([
        h2("Paying"),
        p("There are three ways money can reach you, and all three end up in the same place:"),
        Spacer(1, 4),
        PaymentDiagram(CONTENT_W),
    ]))
    story.append(Spacer(1, 6))
    story.append(p(
        "<b>Card and Instant EFT</b> happen online through PayFast. The customer presses <b>Pay now</b>, "
        "completes the payment, and the order marks itself as paid straight away. Nobody on your team "
        "has to do anything."
    ))
    story.append(p(
        "<b>Invoice</b> is for approved account customers only. They press <b>Pay on invoice</b>, the "
        "stock stays reserved for them with no time limit, and you record the payment once it reflects "
        "in your bank account. You decide, customer by customer, who is allowed this."
    ))

    story.append(h2("Receipts and updates"))
    story.append(p(
        "As soon as an order is paid, the customer can download a receipt showing what they paid, how "
        "and when. They are notified in the portal, and by email, each time their order moves forward "
        "&mdash; approved, paid, ready for collection."
    ))

    story.append(h2("Ordering by WhatsApp"))
    story.append(p(
        "Customers who prefer WhatsApp can message your business number to browse the catalogue, build "
        "a quote, turn it into an order and check on past orders. It is the same system underneath, so "
        "anything done on WhatsApp appears in the portal too."
    ))

    story.append(PageBreak())

    # ---------------- Part 2 ----------------
    story.append(h1("Part 2 &mdash; For your team"))
    story.append(p(
        "Your staff sign in at the same address and see an admin view instead of the shop. What each "
        "person can do depends on the role you give them."
    ))
    story.append(KeepTogether([Spacer(1, 4), RolesDiagram(CONTENT_W)]))
    story.append(Spacer(1, 10))

    story.append(h2("The daily rhythm"))
    story.append(p(
        "Most days there is very little to do. Orders paid by card or EFT look after themselves. "
        "Your team only needs to act in three situations:"
    ))
    story.append(steps_table([
        ("Money arrived in the bank.", "Open the order and press <b>Record payment</b>."),
        ("An order is packed.", "Press <b>Mark ready for collection</b>, and the customer is notified."),
        ("The customer collected it.", "Press <b>Mark collected</b>. That closes the order."),
    ]))

    story.append(h2("Orders"))
    story.append(p(
        "The Orders screen lists everything, newest first. You can search by order number, customer or "
        "email, and filter by stage. Opening an order shows the parts, the totals and the buttons for "
        "whatever that order needs next &mdash; and nothing else, so there is no guessing."
    ))
    story.append(KeepTogether([Spacer(1, 4), StatusDiagram(CONTENT_W)]))
    story.append(Spacer(1, 8))

    story.append(callout(
        "Recording a payment",
        "Only record a payment you have already seen in the bank. Choose how it was paid, enter the "
        "reference, and confirm. The order is marked paid immediately and the customer gets their "
        "receipt &mdash; there is no second approval step.",
        tone="good",
    ))

    story.append(PageBreak())

    story.append(h2("Products"))
    story.append(steps_table([
        ("Add or edit a part.", "Name, code, description, price excluding VAT, stock on hand, category and a photo."),
        ("Manage categories.", "Add your own categories at any time; they appear as filters for customers straight away."),
        ("Bulk import.", "Upload a supplier list and the system reads it for you, matching parts to your categories."),
        ("Export.", "Download the whole catalogue to Excel whenever you need it."),
    ]))

    story.append(h2("Quotes"))
    story.append(p(
        "You can build a quote on a customer's behalf &mdash; useful when someone phones in. Choose the "
        "customer, add the parts, and the quote appears in their portal account. From there you can "
        "email it to them with the PDF attached, or download it yourself."
    ))

    story.append(h2("Customers"))
    story.append(p(
        "Every customer has a page showing what they have spent, their orders and their quotes. This is "
        "also where you allow a customer to <b>order on account</b> &mdash; that is a credit decision, so "
        "the system asks you to confirm it and records who made the change."
    ))

    story.append(h2("The review queue"))
    story.append(p("The portal flags orders worth a second look. Flags do not stop an order &mdash; they just tell you:"))
    story.append(data_table(
        ["Flag", "What it means", "What to do"],
        [
            ["High value", "The order is over your set threshold", "Check it looks right"],
            ["First-time customer", "This is their first completed order", "Confirm the details"],
            ["Not enough stock", "You cannot fill the order right now", "Approve once you can supply, or cancel it"],
        ],
        [90, CONTENT_W - 90 - 150, 150],
    ))

    story.append(h2("Staff"))
    story.append(p(
        "Staff cannot sign themselves up. An admin sends an invitation to their email address, and that "
        "link lets them set their own password. You can change someone's role, suspend them, or remove "
        "them at any time."
    ))

    story.append(h2("Activity log"))
    story.append(p(
        "Admins can see a record of what has happened: sign-ins and failed sign-in attempts, price and "
        "stock changes, payments recorded, staff added or suspended, and files exported. It is split "
        "into customer activity and staff activity so you can look at one without the other."
    ))

    story.append(h2("Reports"))
    story.append(p(
        "Products, quotes and orders can all be exported to Excel, for any date range you choose. "
        "Quote and order exports include a second sheet listing every line item, so the figures can be "
        "handed straight to your bookkeeper."
    ))

    story.append(PageBreak())

    # ---------------- Part 3 ----------------
    story.append(h1("Part 3 &mdash; Reference"))

    story.append(h2("What each order stage means"))
    story.append(data_table(
        ["Stage", "Meaning", "Who moves it on"],
        [
            ["Awaiting approval", "Not enough stock to fill the order yet", "Your team"],
            ["Awaiting payment", "Stock is set aside, waiting for money", "The customer, or your team"],
            ["Paid", "Money received; ready to be picked and packed", "Your team"],
            ["Ready for collection", "Packed and waiting for the customer", "Your team"],
            ["Completed", "Collected. The order is closed", "&mdash;"],
            ["Cancelled", "Called off; stock has gone back on the shelf", "&mdash;"],
        ],
        [110, CONTENT_W - 110 - 95, 95],
    ))

    story.append(h2("VAT"))
    story.append(p(
        "Every price in the portal is shown <b>excluding VAT</b>, with VAT added as a separate line. "
        "Quotes, orders, receipts and the Excel exports all show the amount before VAT, the VAT, and "
        "the total, so the figures match what your accounting system expects."
    ))

    story.append(h2("Stock"))
    story.append(p(
        "Stock is reduced the moment an order is created, not when it is collected &mdash; that is what "
        "stops two customers buying the same last item. If an order is cancelled, or a 60-minute hold "
        "expires, the stock goes straight back on the shelf automatically."
    ))

    story.append(h2("Common questions"))
    story.append(data_table(
        ["Question", "Answer"],
        [
            ["A customer says they paid but the order still says awaiting payment.",
             "Card and EFT payments confirm within a minute or two. If it has been longer, check your bank and use <b>Record payment</b>."],
            ["Can I change a price after a quote has been sent?",
             "Changing a product's price does not change quotes already issued. Those keep the price that was quoted."],
            ["A customer wants to order but has no card.",
             "Either record their EFT once it reflects, or enable ordering on account for them."],
            ["Can two people use the same login?",
             "They can, but the activity log will show both as the same person. Give each staff member their own invitation."],
            ["What happens if we run out of stock mid-order?",
             "The order is created but held for your approval, and your team decides whether to supply or cancel."],
        ],
        [175, CONTENT_W - 175],
    ))

    story.append(Spacer(1, 16))
    story.append(callout(
        "Support",
        "The portal is built and maintained by Quantilytix. For anything that looks wrong, or for changes "
        "you would like made, contact your Quantilytix representative.",
        tone="navy",
    ))

    doc.build(story)
    print("written:", OUT)


if __name__ == "__main__":
    build()
