# `$MOD/prototypes/item.lua`

## Relevant Fields

Item prototypes provide stable internal names and metadata such as `subgroup`; the subgroup can identify intermediate products for display and recommendation ranking. The current pipeline does not parse item prototypes, so item nodes only exist when found as recipe inputs or outputs and have no subgroup metadata.

## Parsing Guidance

Merge item metadata in configured package order. Preserve identity by internal name and inspect the prototype's type/flags/hidden fields as applicable. The official API defines item `hidden` as suppressing the item from lists such as logistics requests and filters; it does not establish that the item is unobtainable in normal play. Keep this visibility behavior distinct from recipe enabled/unlock state and actual production paths. Use subgroup as a classification hint, not as a substitute for recipe availability or recipe-level permissions. Some item-like prototypes may be declared in other package files, so file coverage should be validated against observed graph references rather than assuming this file is exhaustive.

Reference: [ItemPrototype API](https://lua-api.factorio.com/latest/prototypes/ItemPrototype.html).