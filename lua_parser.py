from __future__ import annotations

import re
from typing import Any

Token = tuple[str, str]


def tokenize(source: str) -> list[Token]:
    tokens: list[Token] = []
    index = 0
    while index < len(source):
        char = source[index]
        if char.isspace():
            index += 1
            continue
        if source.startswith("--", index):
            opener = re.match(r"--\[(=*)\[", source[index:])
            if opener:
                close = "]" + opener.group(1) + "]"
                end = source.find(close, index + opener.end())
                index = len(source) if end < 0 else end + len(close)
            else:
                end = source.find("\n", index + 2)
                index = len(source) if end < 0 else end + 1
            continue
        if char == "[":
            opener = re.match(r"\[(=*)\[", source[index:])
            if opener:
                close = "]" + opener.group(1) + "]"
                end = source.find(close, index + opener.end())
                if end < 0:
                    raise ValueError("Unterminated Lua long string")
                tokens.append(("string", source[index + opener.end() : end]))
                index = end + len(close)
                continue
        if char in "\"'":
            quote = char
            start = index
            index += 1
            value: list[str] = []
            while index < len(source) and source[index] != quote:
                if source[index] == "\\" and index + 1 < len(source):
                    escaped = source[index + 1]
                    value.append(
                        {"n": "\n", "r": "\r", "t": "\t", "\\": "\\", '"': '"', "'": "'"}.get(escaped, escaped)
                    )
                    index += 2
                else:
                    value.append(source[index])
                    index += 1
            if index >= len(source):
                raise ValueError(f"Unterminated Lua string at offset {start}")
            tokens.append(("string", "".join(value)))
            index += 1
            continue
        number = re.match(r"(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", source[index:])
        if number:
            tokens.append(("number", number.group(0)))
            index += number.end()
            continue
        identifier = re.match(r"[A-Za-z_]\w*", source[index:])
        if identifier:
            tokens.append(("identifier", identifier.group(0)))
            index += identifier.end()
            continue
        tokens.append(("symbol", char))
        index += 1
    return tokens


def matching_braces(tokens: list[Token]) -> tuple[dict[int, int], dict[int, int]]:
    stack: list[int] = []
    matching: dict[int, int] = {}
    enclosing: dict[int, int] = {}
    for index, (_, value) in enumerate(tokens):
        if stack:
            enclosing[index] = stack[-1]
        if value == "{":
            stack.append(index)
        elif value == "}" and stack:
            opener = stack.pop()
            matching[opener] = index
    return matching, enclosing


class TableReader:
    def __init__(self, tokens: list[Token], matching: dict[int, int]):
        self.tokens = tokens
        self.matching = matching
        self.position = 0

    def read_value(self) -> Any:
        if self.position >= len(self.tokens):
            return None
        kind, value = self.tokens[self.position]
        if value == "{":
            return self.read_table()
        if kind == "string":
            self.position += 1
            return value
        if kind == "number":
            self.position += 1
            return float(value) if any(char in value for char in ".eE") else int(value)
        if kind == "identifier" and value in ("true", "false", "nil"):
            self.position += 1
            return {"true": True, "false": False, "nil": None}[value]
        depth = 0
        while self.position < len(self.tokens):
            token = self.tokens[self.position][1]
            if depth == 0 and token in (",", ";", "}"):
                break
            if token in ("(", "[", "{"):
                depth += 1
            elif token in (")", "]", "}"):
                if depth == 0:
                    break
                depth -= 1
            self.position += 1
        return None

    def read_field_value(self, closer: int) -> Any:
        value = self.read_value()
        if self.position < closer and self.tokens[self.position][1] not in (",", ";"):
            depth = 0
            while self.position < closer:
                token = self.tokens[self.position][1]
                if depth == 0 and token in (",", ";"):
                    break
                if token in ("(", "[", "{"):
                    depth += 1
                elif token in (")", "]", "}"):
                    if depth == 0:
                        break
                    depth -= 1
                self.position += 1
            return None
        return value

    def read_table(self) -> dict[str, Any] | list[Any]:
        closer = self.matching.get(self.position)
        if closer is None:
            raise ValueError("Unmatched Lua table brace")
        self.position += 1
        fields: dict[str, Any] = {}
        items: list[Any] = []
        while self.position < closer:
            if self.tokens[self.position][1] in (",", ";"):
                self.position += 1
                continue
            kind, value = self.tokens[self.position]
            if kind == "identifier" and self.position + 1 < closer and self.tokens[self.position + 1][1] == "=":
                self.position += 2
                fields[value] = self.read_field_value(closer)
            elif value == "[" and self.position + 1 < closer:
                bracket_end = self.matching.get(self.position)
                if bracket_end is not None and bracket_end + 1 < closer and self.tokens[bracket_end + 1][1] == "=":
                    key = self.tokens[self.position + 1][1]
                    self.position = bracket_end + 2
                    fields[str(key)] = self.read_field_value(closer)
                else:
                    items.append(self.read_value())
            else:
                items.append(self.read_value())
            if self.position < closer and self.tokens[self.position][1] not in (",", ";"):
                self.position += 1
        self.position = closer + 1
        if fields and not items:
            return fields
        if items and not fields:
            return items
        if fields:
            fields.update({str(index): value for index, value in enumerate(items, 1)})
            return fields
        return items


def parse_table_at(tokens: list[Token], matching: dict[int, int], position: int) -> Any:
    reader = TableReader(tokens, matching)
    reader.position = position
    return reader.read_value()


def parse_prototypes(source: str, prototype_type: str) -> list[dict[str, Any]]:
    tokens = tokenize(source)
    matching, enclosing = matching_braces(tokens)
    prototypes: list[dict[str, Any]] = []
    seen: set[int] = set()
    for index in range(len(tokens) - 2):
        if tokens[index] != ("identifier", "type") or tokens[index + 1][1] != "=" or tokens[index + 2] != ("string", prototype_type):
            continue
        opener = enclosing.get(index)
        if opener is None or opener in seen:
            continue
        seen.add(opener)
        prototype = parse_table_at(tokens, matching, opener)
        if isinstance(prototype, dict) and isinstance(prototype.get("name"), str):
            prototypes.append(prototype)
    return prototypes
