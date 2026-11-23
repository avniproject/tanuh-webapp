import { Box, Typography } from "@mui/material";
import { useParams, useNavigate } from "react-router-dom";
import { ReviewForm } from "@/forms/ReviewForm";

// tanuh-webapp#5: a case opened from its screening, for the screenings the model sent for review.
export function CaseDetail() {
  const { screeningUuid } = useParams<{ screeningUuid: string }>();
  const navigate = useNavigate();

  if (!screeningUuid) {
    return <Typography color="error">No screening id in URL</Typography>;
  }

  return (
    <Box>
      {/* Keyed by the case, so moving from one case to another starts a fresh form, with its own draft (FW4). */}
      <ReviewForm key={screeningUuid} screeningUuid={screeningUuid} onBack={() => navigate(-1)} />
    </Box>
  );
}
