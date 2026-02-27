// Quick test to check what URL the transformation generates

const testUrl = 'https://res.cloudinary.com/dz8q0fb8m/image/upload/v1772193668/cricket-auction/players/bkx3lbncw9owb8cqvyr9.jpg';

const transformCloudinaryImage = (url, options = {}) => {
  if (!url || !url.includes('res.cloudinary.com')) {
    return url;
  }

  const {
    width,
    height,
    crop = 'fill',
    quality = 'auto',
    format = 'auto',
    dpr = true,
  } = options;

  const uploadIndex = url.indexOf('/upload/');
  if (uploadIndex === -1) return url;

  const baseUrl = url.substring(0, uploadIndex + 8);
  const remainingUrl = url.substring(uploadIndex + 8);

  const transformations = [];
  
  if (width) transformations.push(`w_${width}`);
  if (height) transformations.push(`h_${height}`);
  if (crop && (width || height)) transformations.push(`c_${crop}`);
  if (quality) transformations.push(`q_${quality}`);
  if (format) transformations.push(`f_${format}`);
  if (dpr) transformations.push('dpr_auto');
  
  if (crop === 'fill' || crop === 'thumb') {
    transformations.push('g_auto:subject');
  }

  const transformString = transformations.join(',');
  
  return `${baseUrl}${transformString}/${remainingUrl}`;
};

const result = transformCloudinaryImage(testUrl, {
  width: 600,
  height: 800,
  crop: 'fill',
  quality: 'best',
  format: 'auto',
  dpr: true
});

console.log('Original URL:', testUrl);
console.log('Transformed URL:', result);
console.log('Includes https:', result.includes('https://'));
console.log('Includes res.cloudinary.com:', result.includes('res.cloudinary.com'));
console.log('Includes dz8q0fb8m:', result.includes('dz8q0fb8m'));
