# `lua_parser.py`

## Current Role

The tokenizer and `parse_prototypes` extract literal Lua tables containing a requested `type` and a string `name`. `TableReader` supports string, number, boolean, nil, keyed, and sequence values. This parser is shared by recipe and technology readers.

## Boundary

This is not a Lua interpreter. Function calls, computed expressions, loops, and `require` results are not evaluated. The reader may encounter a prototype table while omitting computed field values, or miss a prototype whose type/name is generated dynamically. New data loaders must surface missing required fields instead of treating absent parsed values as reliable defaults.

Add parser fixtures for each new static shape; do not expand into a general Lua runtime as part of the mall feature.