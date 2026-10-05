import test from "node:test";
import assert from "node:assert/strict";
import { normalizeVenue, containerTitle } from "../.tests-build/venues.js";
import {
  DEFAULT_CONFERENCE_RULES,
  normalizeConference,
} from "../.tests-build/conferences.js";

const paper = (venue) => ({
  itemType: "conferencePaper",
  title: "A paper",
  proceedingsTitle: venue,
  date: "2024",
});
const identify = (venue) =>
  normalizeConference(paper(venue), DEFAULT_CONFERENCE_RULES, "standard");

test("year, edition and punctuation variants share one catalog identity", () => {
  for (const venue of [
    "CVPR2024",
    "2024CVPR",
    "CVPR'24",
    "CVPR’24",
    "Proc. of the 37th IEEE/CVF Conference on Computer Vision & Pattern Recognition (CVPR)",
    "2024 IEEE 37 Conference on Computer Vision and Pattern Recognition",
    "Proceedings: XXXVII Annual Conference on Computer Vision and Pattern Recognition",
    "IEEE Conference for Computer Vision & Pattern Recognition, Volume 2",
  ]) {
    const result = identify(venue);
    assert.equal(result.rule?.id, "cvpr", venue);
    assert.equal(
      result.metadata.proceedingsTitle,
      "Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition",
    );
    assert.equal(result.metadata.date, "2024");
    assert.equal(result.metadata.conferenceName, undefined);
    assert.equal(
      normalizeConference(result.metadata, DEFAULT_CONFERENCE_RULES, "standard")
        .metadata.proceedingsTitle,
      result.metadata.proceedingsTitle,
    );
  }
});

test("matching keeps numeric topic names and distinguishes workshops from main tracks", () => {
  assert.equal(
    normalizeVenue("2024 International Conference on 3D Vision (3DV)"),
    "international conference on 3d vision 3dv",
  );
  for (const [venue, id] of [
    ["ICCV 2023 Workshops", "iccv-workshops"],
    ["ICCV Workshop", "iccv-workshops"],
    ["ICML 2024 Workshops", "icml-workshops"],
  ])
    assert.equal(identify(venue).rule?.id, id, venue);
  for (const venue of [
    "ECCV Unlisted Workshop",
    "CVPR Unlisted Findings",
    "FSE'24",
    "SEC2024",
    "Pattern Recognition",
    "NECCV2024",
  ]) {
    const metadata = paper(venue);
    const result = normalizeConference(
      metadata,
      DEFAULT_CONFERENCE_RULES,
      "standard",
    );
    assert.equal(result.rule, undefined, venue);
    assert.deepEqual(result.metadata, metadata);
  }
});

test("conflicting event and proceedings identities are not normalized", () => {
  const metadata = {
    ...paper("CVPR 2024"),
    conferenceName: "European Conference on Computer Vision",
  };
  assert.deepEqual(
    normalizeConference(metadata, DEFAULT_CONFERENCE_RULES, "standard"),
    { metadata },
  );
  const consistent = {
    ...paper("FSE 2024"),
    conferenceName: "Fast Software Encryption",
  };
  assert.equal(
    normalizeConference(consistent, DEFAULT_CONFERENCE_RULES).rule?.id,
    "fse-crypto",
  );
});

test("proceedings repairs read abbreviated and year-prefixed misplaced titles without rewriting events", () => {
  for (const venue of [
    "Proc. of the IEEE/CVF Conference on Computer Vision and Pattern Recognition",
    "2024 Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition",
  ]) {
    const metadata = { ...paper("CVPR"), conferenceName: venue };
    assert.equal(containerTitle(metadata), venue);
    const result = normalizeConference(
      metadata,
      DEFAULT_CONFERENCE_RULES,
      "original",
    );
    assert.equal(result.metadata.proceedingsTitle, venue);
    assert.equal(result.metadata.conferenceName, venue);
  }
});

test("catalog aliases keep their identity through mechanical year and edition variants", () => {
  for (const rule of DEFAULT_CONFERENCE_RULES) {
    for (const alias of rule.aliases) {
      const baseline = normalizeConference(
        paper(alias),
        DEFAULT_CONFERENCE_RULES,
      ).rule?.id;
      for (const venue of [
        `2024 ${alias}`,
        `Proceedings of the 31st ${alias} (2024)`,
      ]) {
        assert.equal(
          normalizeConference(paper(venue), DEFAULT_CONFERENCE_RULES).rule?.id,
          baseline,
          venue,
        );
      }
    }
  }
});
