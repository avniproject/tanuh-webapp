import { Box, Skeleton, Typography } from "@mui/material";
import { getSignedMediaUrl } from "@/api/media";
import { useAsync } from "@/hooks/useAsync";

interface Props {
  src: string | undefined;
  alt: string;
  sx?: object;
}

export function MediaImg({ src, alt, sx }: Props) {
  const { data: signed, error } = useAsync(() => (src ? getSignedMediaUrl(src) : Promise.resolve("")), [src]);

  if (!src) return <Typography color="text.secondary">No image</Typography>;
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
