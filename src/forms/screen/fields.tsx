import { Box, ButtonBase, InputBase, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { FieldValue } from "@/forms/engine/answers";
import type { AnswerDef, ElementDef } from "@/forms/engine/formDef";
import { isReadOnly } from "@/forms/engine/formDef";
import type { ElementStatus } from "@/forms/engine/ruleRunner";
import { CR } from "@/theme/tokens";

export interface PlaceOption {
  uuid: string;
  name: string;
  type: string;
}

export interface FieldProps {
  element: ElementDef;
  value: FieldValue | undefined;
  status: ElementStatus | undefined;
  onChange: (value: FieldValue | undefined) => void;
  disabled: boolean;
  /** Places a Location question offers. */
  places: PlaceOption[];
  /** Shown under the control: the question was left unanswered at a submit attempt. */
  required: boolean;
  id: string;
}

const inputSx = {
  height: 44,
  px: 2,
  bgcolor: CR.surface,
  border: `1px solid ${CR.inputBorder}`,
  borderRadius: CR.radius.pill,
  fontFamily: CR.font,
  fontSize: 14,
  color: CR.text,
  "&.Mui-focused": { outline: `2px solid ${CR.brand}`, outlineOffset: 2 },
  "&.Mui-disabled": { bgcolor: CR.tableHead },
} as const;

function OptionPill({
  label,
  selected,
  onClick,
  disabled,
  role,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  disabled: boolean;
  role: "radio" | "checkbox";
}) {
  return (
    <ButtonBase
      role={role}
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      sx={{
        px: 2,
        minHeight: 40,
        py: 0.75,
        borderRadius: CR.radius.pill,
        border: `1.5px solid ${selected ? CR.brand : CR.inputBorder}`,
        bgcolor: selected ? CR.selected : CR.surface,
        color: selected ? CR.heading : CR.textTertiary,
        fontFamily: CR.font,
        fontSize: 14,
        fontWeight: selected ? 600 : 500,
        textAlign: "left",
        "&:hover": { bgcolor: selected ? CR.selected : CR.navHover },
        "&:focus-visible": { outline: `2px solid ${CR.brand}`, outlineOffset: 2 },
        "&.Mui-disabled": { opacity: selected ? 0.9 : 0.55 },
      }}
    >
      {label}
    </ButtonBase>
  );
}

function offered(element: ElementDef, status: ElementStatus | undefined): AnswerDef[] {
  const hidden = new Set(status?.hiddenAnswers ?? []);
  return element.concept.answers.filter((a) => !hidden.has(a.uuid));
}

function SingleSelect({ element, value, status, onChange, disabled, id }: FieldProps) {
  const answers = offered(element, status);
  if (answers.length > 5) {
    return (
      <Box
        component="select"
        id={id}
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value || undefined)}
        sx={{ ...inputSx, width: "100%", maxWidth: 420 }}
      >
        <option value="">Select</option>
        {answers.map((a) => (
          <option key={a.uuid} value={a.uuid}>
            {a.name}
          </option>
        ))}
      </Box>
    );
  }
  return (
    <Stack direction="row" role="radiogroup" aria-labelledby={`${id}-label`} sx={{ flexWrap: "wrap", gap: 1 }}>
      {answers.map((a) => (
        <OptionPill
          key={a.uuid}
          role="radio"
          label={a.name}
          selected={value === a.uuid}
          disabled={disabled}
          // Choosing the chosen answer again clears it, as on the phone.
          onClick={() => onChange(value === a.uuid ? undefined : a.uuid)}
        />
      ))}
    </Stack>
  );
}

function MultiSelect({ element, value, status, onChange, disabled, id }: FieldProps) {
  const answers = offered(element, status);
  const chosen = Array.isArray(value) ? value : [];
  const toggle = (a: AnswerDef) => {
    if (chosen.includes(a.uuid)) {
      const next = chosen.filter((u) => u !== a.uuid);
      onChange(next.length ? next : undefined);
      return;
    }
    // An answer such as "Prefer not to say" stands alone.
    const exclusive = new Set(answers.filter((x) => x.unique).map((x) => x.uuid));
    onChange(a.unique ? [a.uuid] : [...chosen.filter((u) => !exclusive.has(u)), a.uuid]);
  };
  return (
    <Stack direction="row" role="group" aria-labelledby={`${id}-label`} sx={{ flexWrap: "wrap", gap: 1 }}>
      {answers.map((a) => (
        <OptionPill
          key={a.uuid}
          role="checkbox"
          label={a.name}
          selected={chosen.includes(a.uuid)}
          disabled={disabled}
          onClick={() => toggle(a)}
        />
      ))}
    </Stack>
  );
}

function NumericField({ element, value, onChange, disabled, id }: FieldProps) {
  const { unit, lowAbsolute, highAbsolute } = element.concept;
  const n = typeof value === "number" ? value : null;
  const outOfRange =
    n !== null && ((lowAbsolute !== null && n < lowAbsolute) || (highAbsolute !== null && n > highAbsolute));
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1}>
        <InputBase
          id={id}
          type="number"
          value={n ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          inputProps={{ inputMode: "decimal", min: lowAbsolute ?? undefined, max: highAbsolute ?? undefined }}
          sx={{ ...inputSx, width: 160 }}
        />
        {unit && <Typography sx={{ fontFamily: CR.font, fontSize: 14, color: CR.textSecondary }}>{unit}</Typography>}
      </Stack>
      {outOfRange && (
        <Typography role="alert" sx={{ mt: 0.5, fontFamily: CR.font, fontSize: 13, color: CR.error }}>
          Enter a value between {lowAbsolute ?? "…"} and {highAbsolute ?? "…"}.
        </Typography>
      )}
    </Box>
  );
}

function TextField({ element, value, onChange, disabled, id }: FieldProps) {
  const notes = element.concept.dataType === "Notes";
  return (
    <InputBase
      id={id}
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      multiline={notes}
      minRows={notes ? 4 : undefined}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      sx={{
        ...inputSx,
        width: "100%",
        maxWidth: notes ? "100%" : 520,
        ...(notes ? { height: "auto", py: 1.5, borderRadius: CR.radius.panel, alignItems: "flex-start" } : {}),
      }}
    />
  );
}

function DateField({ value, onChange, disabled, id }: FieldProps) {
  return (
    <InputBase
      id={id}
      type="date"
      value={typeof value === "string" ? value.slice(0, 10) : ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === "" ? undefined : new Date(e.target.value).toISOString())}
      sx={{ ...inputSx, width: 200 }}
    />
  );
}

function PlaceField({ value, onChange, disabled, id, places }: FieldProps) {
  const known = typeof value === "string" && places.some((p) => p.uuid === value);
  return (
    <Box>
      <Box
        component="select"
        id={id}
        value={known ? (value as string) : ""}
        disabled={disabled || places.length === 0}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value || undefined)}
        sx={{ ...inputSx, width: "100%", maxWidth: 420 }}
      >
        <option value="">{typeof value === "string" && !known ? value : "Select"}</option>
        {places.map((p) => (
          <option key={p.uuid} value={p.uuid}>
            {p.name} · {p.type}
          </option>
        ))}
      </Box>
      {places.length === 0 && (
        <Typography sx={{ mt: 0.5, fontFamily: CR.font, fontSize: 13, color: CR.textSecondary }}>
          No hospital is listed in your area in Avni, so this cannot be chosen here.
        </Typography>
      )}
    </Box>
  );
}

function Computed({ element, value }: { element: ElementDef; value: FieldValue | undefined }) {
  const shown =
    element.concept.dataType === "Coded"
      ? (Array.isArray(value) ? value : [value])
          .map((u) => element.concept.answers.find((a) => a.uuid === u)?.name)
          .filter(Boolean)
          .join(", ")
      : value;
  return (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
      <Box
        sx={{
          px: 2,
          py: 0.75,
          borderRadius: CR.radius.pill,
          bgcolor: CR.tableHead,
          border: `1px solid ${CR.border}`,
          fontFamily: CR.font,
          fontSize: 14,
          fontWeight: 600,
          color: CR.text,
        }}
      >
        {shown === undefined || shown === "" ? "–" : String(shown)}
        {element.concept.unit ? ` ${element.concept.unit}` : ""}
      </Box>
      <Typography sx={{ fontFamily: CR.font, fontSize: 13, color: CR.textSecondary }}>
        Calculated by form rule · not editable
      </Typography>
    </Stack>
  );
}

function Control(props: FieldProps): ReactNode {
  const { element } = props;
  if (isReadOnly(element)) return <Computed element={element} value={props.value} />;
  switch (element.concept.dataType) {
    case "Coded":
      return element.type === "MultiSelect" ? <MultiSelect {...props} /> : <SingleSelect {...props} />;
    case "Numeric":
      return <NumericField {...props} />;
    case "Text":
    case "Notes":
      return <TextField {...props} />;
    case "Date":
      return <DateField {...props} />;
    case "Location":
      return <PlaceField {...props} />;
    default:
      return (
        <Typography sx={{ fontFamily: CR.font, fontSize: 13, color: CR.textSecondary }}>
          This kind of question ({element.concept.dataType}) cannot be answered here yet. Fill it in Avni.
        </Typography>
      );
  }
}

/** One question: its label, the reason it is asked when that comes from the screening, and its control. */
export function Field(props: FieldProps) {
  const { element, status, required, id } = props;
  const fromScreening = !!element.rule && element.rule.includes("findLatestObservationFromEncounters");
  return (
    <Box sx={{ py: 1.5 }} data-field={element.uuid}>
      <Typography
        id={`${id}-label`}
        component="label"
        htmlFor={id}
        sx={{ display: "block", mb: 0.75, fontFamily: CR.font, fontSize: 15, fontWeight: 500, color: CR.text }}
      >
        {element.name}
        {element.mandatory && (
          <Box component="span" aria-hidden sx={{ color: CR.error, ml: 0.5 }}>
            *
          </Box>
        )}
      </Typography>
      {fromScreening && (
        <Typography sx={{ mb: 0.75, fontFamily: CR.font, fontSize: 13, color: CR.textSecondary }}>
          Asked because of an answer given at screening.
        </Typography>
      )}
      <Control {...props} />
      {(status?.errors ?? []).map((message) => (
        <Typography key={message} role="alert" sx={{ mt: 0.5, fontFamily: CR.font, fontSize: 13, color: CR.error }}>
          {message}
        </Typography>
      ))}
      {required && (
        <Typography role="alert" sx={{ mt: 0.5, fontFamily: CR.font, fontSize: 13, color: CR.error }}>
          This answer is required
        </Typography>
      )}
    </Box>
  );
}
