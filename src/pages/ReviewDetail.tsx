import { Box, Button, Stack, Typography } from "@mui/material";
import { useParams, useNavigate } from "react-router-dom";
import { ReviewForm } from "@/forms/ReviewForm";

export function ReviewDetail() {
  const { encounterUuid } = useParams<{ encounterUuid: string }>();
  const navigate = useNavigate();

  if (!encounterUuid) {
    return <Typography color="error">No encounter id in URL</Typography>;
  }

  return (
    <Box>
      <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
        <Button onClick={() => navigate(-1)} sx={{ minWidth: 0, mr: 1 }}>
          ←
        </Button>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          Review
        </Typography>
      </Stack>
      <ReviewForm encounterUuid={encounterUuid} />
    </Box>
  );
}
