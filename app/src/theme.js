// The same palette as the extension's dashboard (review.html). The phone is the same tool on a
// different screen, and a learner glancing between them should not feel two products.
const C = {
  bg: "#fafafa",
  card: "#fff",
  line: "#e8e8e8",
  text: "#1a1a1a",
  dim: "#888",
  blue: "#4a7dff",
  green: "#3fbf7f",
  greenDark: "#2f7d51",
  red: "#c0392b",
  amber: "#b26a00",
};

// The extension colours parts of speech against a black caption bar; the same hues would glare
// on a white page, so these are the darker equivalents. Content words carry colour, function
// words stay grey — that contrast is what makes a phrasal verb visible at a glance.
const POS = {
  verb: "#1a6fb5",
  noun: "#9a6508",
  adj: "#357a38",
  prep: "#c2185b",
  aux: "#9aa0a6",
  det: "#9aa0a6",
  pron: "#9aa0a6",
  conj: "#9aa0a6",
};

const S = {
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 16 },
  h1: { fontSize: 24, fontWeight: "700", color: C.text },
  sub: { fontSize: 13, color: C.dim, marginTop: 2 },
  card: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  label: { fontSize: 12, color: C.dim, fontWeight: "600" },
  big: { fontSize: 30, fontWeight: "700", color: C.text },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  btn: {
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  btnText: { fontSize: 15, color: C.text, fontWeight: "600" },
  primary: { backgroundColor: C.text, borderColor: C.text },
  primaryText: { color: "#fff" },
  input: {
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: C.text,
  },
};

module.exports = { C, S, POS };
