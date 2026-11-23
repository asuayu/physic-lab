"""Copy the local Gaokao question index and its figures into the static site."""

import argparse
from collections import Counter, defaultdict
from hashlib import sha256
from html import escape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit
from uuid import NAMESPACE_URL, uuid5
from xml.etree import ElementTree


OUTPUT = Path(__file__).resolve().parents[1] / "public" / "gaokao-bank" / "data"
PUBLIC_DATA = "/gaokao-bank/data"
ARCHIVE_NAME = "gaokao-physics-archive"
ARCHIVE_PREFIX = f"../{ARCHIVE_NAME}/"
ARCHIVE_URL = "https://github.com/YLXDXX/gaokao-physics-archive"
BODY_FIELDS = ("body", "answer", "memo")
QUESTION_FIELDS = ("paper", "year", "region", "number", "title", "type", "chapter", "points", "score", "flags")
CONTENT_TAGS = set("a b br code div figure figcaption img li ol p span strong table tr td u ul".split())
CONTENT_CLASSES = set("answer-blank choices figures math-tex question-table ref-label subquestions table-scroll tex-block tex-command".split())
VOID_TAGS = {"br", "img"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".svg"}
# The original archive relies on these LaTeX package commands in a few solutions.
WEB_MACROS = {
    r"\odv": r"\frac{\mathrm{d}#1}{\mathrm{d}#2}",
    r"\odif": r"\mathrm{d}#1",
    r"\textasciitilde": r"\mathord{\sim}",
}


def write_changed(path, payload):
    if path.is_file() and path.read_bytes() == payload:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_bytes(payload)
    temp.replace(path)


def write_json(path, value):
    json_bytes = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    write_changed(path, json_bytes + b"\n")


def validate_svg(payload, path):
    svg = payload.decode("utf-8-sig")
    if re.search(r"<!\s*(?:doctype|entity)|<\?xml-stylesheet|@import", svg, re.I):
        raise ValueError(f"Unsupported SVG declaration: {path}")

    for element in ElementTree.fromstring(svg).iter():
        if element.tag.split("}")[-1].lower() in {"script", "foreignobject", "a"}:
            raise ValueError(f"Unsafe SVG element: {path}")
        for name, value in element.attrib.items():
            name = name.split("}")[-1].lower()
            if name.startswith("on") or (name in {"href", "src"} and not safe_svg_reference(value)):
                raise ValueError(f"Unsafe SVG attribute: {path}")

    for reference in re.findall(r"url\(\s*([^)]*)\)", svg, re.I):
        if not safe_svg_reference(reference.strip().strip("\"'")):
            raise ValueError(f"External SVG reference: {path}")


def safe_svg_reference(value):
    return value.startswith(("#", "data:image/png;base64,", "data:image/jpeg;base64,"))


class Figures:
    def __init__(self, source, output):
        self.archive = (source / ARCHIVE_NAME).resolve(strict=True)
        self.previews = source / "高考物理查题" / "assets" / "pdf"
        self.output = output / "images"
        self.by_source = {}
        self.unique = set()
        self.pdf_count = 0

    def url(self, source_url):
        if source_url in self.by_source:
            return self.by_source[source_url]

        url = urlsplit(source_url)
        decoded = unquote(url.path)
        if url.scheme or url.netloc or url.query or url.fragment or not decoded.startswith(ARCHIVE_PREFIX):
            raise ValueError(f"Invalid local figure URL: {source_url}")
        relative = decoded.removeprefix(ARCHIVE_PREFIX)
        path = (self.archive / relative).resolve(strict=True)
        if not path.is_relative_to(self.archive):
            raise ValueError(f"Figure outside source archive: {source_url}")

        if path.suffix.lower() == ".pdf":
            canonical = f"{ARCHIVE_NAME}/{path.relative_to(self.archive).as_posix()}"
            preview_name = sha256(canonical.encode("utf-8")).hexdigest()[:20] + ".png"
            path = self.previews / preview_name
            self.pdf_count += 1

        suffix = path.suffix.lower()
        if suffix not in IMAGE_SUFFIXES:
            raise ValueError(f"Unsupported figure format: {path}")
        payload = path.read_bytes()
        if suffix == ".svg":
            validate_svg(payload, path)
        name = sha256(payload).hexdigest()[:24] + suffix
        if name not in self.unique:
            write_changed(self.output / name, payload)
            self.unique.add(name)

        public_url = f"{PUBLIC_DATA}/images/{name}"
        self.by_source[source_url] = public_url
        return public_url


class QuestionMarkup(HTMLParser):
    def __init__(self, figures):
        super().__init__()
        self.figures = figures
        self.parts = []
        self.in_pdf_fallback = False

    def convert(self, value):
        self.feed(value)
        self.close()
        if self.in_pdf_fallback:
            raise ValueError("Unclosed PDF figure object")
        result = "".join(self.parts)
        self.parts.clear()
        self.reset()
        return result

    def handle_starttag(self, tag, attrs):
        if self.in_pdf_fallback:
            return

        attrs = dict(attrs)
        if tag == "object" and attrs.get("type") == "application/pdf":
            self.in_pdf_fallback = True
            self.add_tag("img", {"src": self.figures.url(attrs["data"]), "alt": "试题配图", "loading": "lazy"})
            return
        if tag not in CONTENT_TAGS:
            raise ValueError(f"Unsupported question element: {tag}")

        allowed = {}
        classes = [name for name in attrs.get("class", "").split() if name in CONTENT_CLASSES]
        if classes:
            allowed["class"] = " ".join(classes)
        if "math-tex" in classes:
            allowed.update({"data-tex": attrs["data-tex"], "data-display": attrs["data-display"]})
        if tag == "img":
            allowed.update(src=self.figures.url(attrs["src"]), alt=attrs.get("alt", "试题配图"), loading="lazy")
        if tag == "a":
            allowed.update(href=self.figures.url(attrs["href"]), target="_blank", rel="noopener noreferrer")
        if tag == "td" and attrs.get("colspan", "").isdigit():
            allowed["colspan"] = attrs["colspan"]
        self.add_tag(tag, allowed)

    def add_tag(self, tag, attrs):
        attributes = "".join(f' {name}="{escape(value, quote=True)}"' for name, value in attrs.items())
        self.parts.append(f"<{tag}{attributes}>")

    def handle_endtag(self, tag):
        if self.in_pdf_fallback:
            self.in_pdf_fallback = tag != "object"
        elif tag in CONTENT_TAGS and tag not in VOID_TAGS:
            self.parts.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.in_pdf_fallback:
            self.parts.append(escape(data, quote=False))


def read_archive(source):
    filename = source / "高考物理查题" / "data.js"
    script = filename.read_text(encoding="utf-8-sig").strip()
    prefix = "window.QUESTION_ARCHIVE="
    if not script.startswith(prefix) or not script.endswith(";"):
        raise ValueError(f"Unexpected question index format: {filename}")
    return json.loads(script[len(prefix):-1])


def import_archive(source, output):
    data = read_archive(source)
    figures = Figures(source, output)
    markup = QuestionMarkup(figures)
    papers_by_year = defaultdict(list)
    questions_by_year = defaultdict(list)
    question_count_by_paper = Counter(q["paper"] for q in data["questions"])
    for paper in data["papers"]:
        year = paper["year"]
        entry = {key: paper[key] for key in ("id", "title", "region")}
        entry["count"] = question_count_by_paper[paper["id"]]
        papers_by_year[year].append(entry)

    occurrences = Counter()
    for question in data["questions"]:
        anchor = f'{unquote(question["source"])}|{question["number"]}'
        identity = f"{anchor}|{occurrences[anchor]}"
        occurrences[anchor] += 1
        entry = {field: question[field] for field in QUESTION_FIELDS}
        entry["id"] = "q_" + uuid5(NAMESPACE_URL, f"gaokao-physics:{identity}").hex
        for field in BODY_FIELDS:
            entry[field] = markup.convert(question[field])
        questions_by_year[question["year"]].append(entry)

    years = []
    stats = {key: data["stats"][key] for key in ("papers", "questions", "years", "yearMin", "yearMax", "revision")}
    if len(papers_by_year) != stats["years"] or set(papers_by_year) != set(questions_by_year):
        raise ValueError("Question and paper years disagree with the source index")
    if len(data["papers"]) != stats["papers"] or len(data["questions"]) != stats["questions"]:
        raise ValueError("Question or paper count disagrees with the source index")

    for year in sorted(papers_by_year, reverse=True):
        papers = papers_by_year[year]
        questions = questions_by_year[year]
        if sum(paper["count"] for paper in papers) != len(questions):
            raise ValueError(f"Question and paper counts disagree for {year}")
        relative = f"years/{year}.json"
        write_json(output / relative, {"year": year, "papers": papers, "questions": questions})
        years.append({"year": year, "paperCount": len(papers), "questionCount": len(questions), "path": f"{PUBLIC_DATA}/{relative}"})

    macros = WEB_MACROS | data["macros"]
    write_json(output / "index.json", {"stats": stats, "years": years, "macros": macros, "sourceUrl": ARCHIVE_URL})
    return {**stats, "uniqueImages": len(figures.unique), "pdfPreviews": figures.pdf_count}


def main():
    parser = argparse.ArgumentParser(description="将资料仓库里的离线高考物理题库导入网站。")
    parser.add_argument("--source", type=Path, required=True, help="包含高考物理查题和 gaokao-physics-archive 的资料仓库路径")
    args = parser.parse_args()
    stats = import_archive(args.source.resolve(strict=True), OUTPUT)
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
