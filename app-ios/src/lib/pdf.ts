/**
 * Genera PDFs a partir de HTML. En Android/iOS crea el archivo y abre el menu para guardarlo o compartirlo; en la
 * web abre el dialogo de impresion del navegador, donde se elige "Guardar como PDF".
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export async function sharePdf(html: string, fileTitle: string) {
  if (Platform.OS === 'web') {
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.title = fileTitle;
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 300);
      return;
    }
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 }); // A4
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: fileTitle, UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ uri });
  }
}
