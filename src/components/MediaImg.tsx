import { Box, Skeleton, Typography } from "@mui/material";
import CloudSyncOutlinedIcon from "@mui/icons-material/CloudSyncOutlined";
import { getSignedMediaUrl, isPendingMediaUpload } from "@/api/media";
import { useAsync } from "@/hooks/useAsync";

interface Props {
  src: string | undefined;
  alt: string;
  sx?: object;
}

export function MediaImg({ src, alt, sx }: Props) {
  const pendingUpload = !!src && isPendingMediaUpload(src);
  const { data: signed, error } = useAsync(
    () => (src && !pendingUpload ? getSignedMediaUrl(src) : Promise.resolve("")),
    [src, pendingUpload],
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
  if (!signed) return <Skeleton variant="rectangular" sx={{ width: "100%", aspectRatio: "4/3", ...sx }} />;
  return (
    <Box
      component="img"
      src={signed}
      alt={alt}
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
