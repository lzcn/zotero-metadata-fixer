import test from "node:test";
import assert from "node:assert/strict";
import { matchesAuthors, rankCandidates } from "../.tests-build/matching.js";
import { matchesPublication } from "../.tests-build/metadata.js";
import { FakeItem, published } from "./helpers.mjs";

const lu = { firstName: "Zhi", lastName: "Lu", creatorType: "author" };
test("matching rejects different given names despite a shared surname and title", () => {
  for (const name of ["Wei Lu", "Lu, Wei", "Zheng Lu", "Zhi Luo"])
    assert.equal(matchesAuthors([lu], [name]), false, name);
  const item = new FakeItem();
  assert.deepEqual(
    rankCandidates(item, [
      { source: "Index", title: item.getField("title"), authors: ["Wei Lu"] },
    ]),
    [],
  );
  assert.equal(
    matchesPublication(
      item,
      { source: "Index", title: published.title },
      { ...published, creators: [{ ...lu, firstName: "Wei" }] },
    ),
    false,
  );
});

test("matching accepts initials, comma/reversed names and abbreviated middle names", () => {
  for (const name of ["Zhi Lu", "LU, ZHI", "Z. Lu", "Lu Z", "Zhi Lu et al."])
    assert.equal(matchesAuthors([lu], [name]), true, name);
  for (const [firstName, author] of [
    ["Zhi Li", "ZL Lu"],
    ["ZL", "Zhi Li Lu"],
    ["Yu Lin", "Yu Lu"],
    ["Jean Pierre", "J.-P. Lu"],
  ])
    assert.equal(
      matchesAuthors([{ ...lu, firstName }], [author]),
      true,
      author,
    );
  assert.equal(
    matchesAuthors([{ ...lu, firstName: "Zhi Li" }], ["ZW Lu"]),
    false,
  );
});

test("matching retains accented, compound-family and Chinese name identities", () => {
  assert.equal(
    matchesAuthors(
      [{ firstName: "José", lastName: "de la Cruz" }],
      ["Jose de la Cruz"],
    ),
    true,
  );
  for (const name of ["卢志", "志卢"])
    assert.equal(
      matchesAuthors([{ firstName: "志", lastName: "卢" }], [name]),
      true,
    );
  assert.equal(
    matchesAuthors([{ firstName: "志", lastName: "卢" }], ["卢伟"]),
    false,
  );
});

test("multiple author lists require corroboration while truncated lists remain usable", () => {
  const authors = [
    lu,
    { firstName: "Alice", lastName: "Chen", creatorType: "author" },
  ];
  assert.equal(matchesAuthors(authors, ["Z. Lu", "A. Chen"]), true);
  assert.equal(matchesAuthors(authors, ["Zhi Lu", "Bob Chen"]), false);
  assert.equal(matchesAuthors(authors, ["Zhi Lu", "Somebody Else"]), false);
  assert.equal(matchesAuthors(authors, ["Z. Lu et al."]), true);
  assert.equal(
    matchesAuthors(
      [
        ...authors,
        { firstName: "Editor", lastName: "Other", creatorType: "editor" },
      ],
      ["Zhi Lu", "Alice Chen"],
    ),
    true,
  );
});

test("editor-only metadata cannot authorize a publication upgrade", () => {
  assert.equal(
    matchesPublication(
      new FakeItem(),
      { source: "Index", title: published.title },
      { ...published, creators: [{ ...lu, creatorType: "editor" }] },
    ),
    false,
  );
});

test("author corroboration uses distinct people and permits same-family truncation", () => {
  const creators = [lu, { ...lu, firstName: "Zheng" }];
  assert.equal(matchesAuthors(creators, ["Z. Lu", "Alice Chen"]), false);
  assert.equal(matchesAuthors(creators, ["Zhi Lu"]), true);
  assert.equal(matchesAuthors(creators, ["Z. Lu", "Zheng Lu"]), true);
  assert.equal(matchesAuthors(creators, ["Zhi Lu", "Bob Lu"]), false);
});
