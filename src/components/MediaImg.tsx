import { useEffect, useState } from "react";
import { Box, Skeleton, Typography } from "@mui/material";
import CloudSyncOutlinedIcon from "@mui/icons-material/CloudSyncOutlined";
import { evictSignedMediaUrl, getSignedMediaUrl, isPendingMediaUpload } from "@/api/media";
import { useAsync } from "@/hooks/useAsync";

interface Props {
  src: string | undefined;
  alt: string;
  sx?: object;
}

export function MediaImg({ src, alt, sx }: Props) {
  const pendingUpload = !!src && isPendingMediaUpload(src);
  // A signed URL can expire while cached (long-open session) — on <img> error,
  // evict it and re-sign once; a second failure means the object itself is bad.
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [src]);
  const { data: signed, error } = useAsync(
    () => (src && !pendingUpload ? getSignedMediaUrl(src) : Promise.resolve("")),
    [src, pendingUpload, attempt],
  );

  if (!src) return <Typography color="text.secondary">No image</Typography>;
  if (pendingUpload)
    return (
      <Box
        sx={{
          width: "100%",
          aspectRatio: "4/3",
          maxHeight: 280,
          borderRadius: 1,
          bgcolor: "grey.100",
          border: "1px dashed",
          borderColor: "grey.400",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
          px: 2,
          ...sx,
        }}
      >
        <CloudSyncOutlinedIcon color="disabled" fontSize="large" />
        <Typography color="text.secondary" variant="body2" align="center">
          Photo not yet uploaded from the health worker&apos;s device. It will appear after their
          next sync.
        </Typography>
      </Box>
    );
  if (error) return <Typography color="error">Image unavailable: {error}</Typography>;
  if (failed) return <Typography color="error">Image unavailable: failed to load from storage</Typography>;
  if (!signed) return <Skeleton variant="rectangular" sx={{ width: "100%", aspectRatio: "4/3", ...sx }} />;
  return (
    <Box
      component="img"
      src={signed}
      alt={alt}
      onError={() => {
        if (src) evictSignedMediaUrl(src);
        if (attempt === 0) setAttempt(1);
        else setFailed(true);
      }}
      sx={{
        width: "100%",
        maxHeight: 280,
        objectFit: "contain",
        bgcolor: "#000",
        borderRadius: 1,
        display: "block",
        ...sx,
      }}
    />
  );
}
